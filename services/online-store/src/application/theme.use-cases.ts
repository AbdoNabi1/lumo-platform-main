import {
  checkBrandContrast,
  imageRefsOf,
  validateThemeDocument,
  type ContrastWarning,
  type ThemeDocument,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { imageNotFound, invalidContent, releaseNotFound, versionConflict } from "../domain/errors";
import { ThemePublished } from "../domain/events";
import { RELEASES_KEPT, type StorefrontTheme } from "../domain/storefront-theme";
import type { OnlineStoreDeps } from "./deps";
import { eventProps, inUnitOfWork, iso } from "./guarded";
import type { ImageDto } from "./ports";

export interface ThemeStateView {
  readonly draft: ThemeDocument;
  readonly published: ThemeDocument | null;
  readonly draftRevision: number;
  readonly draftSavedAt: string | null;
  readonly publishedDraftRevision: number | null;
  readonly releaseNumber: number;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly hasUnpublishedChanges: boolean;
  readonly images: Readonly<Record<string, ImageDto>>;
  readonly version: number;
}
export interface SaveDraftView {
  readonly draftRevision: number;
  readonly version: number;
  readonly warnings: readonly ContrastWarning[];
}
export interface DraftRevisionView {
  readonly draftRevision: number;
  readonly version: number;
}
export interface PublishView {
  readonly releaseNumber: number;
  readonly publishedAt: string;
}
export interface ReleasesView {
  readonly releases: readonly {
    readonly releaseNumber: number;
    readonly publishedAt: string;
    readonly publishedByName: string | null;
  }[];
}

const IMAGE_PATHS = { logo: "brand.logo.imageRef", favicon: "brand.favicon.imageRef" } as const;

export class GetTheme {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<ThemeStateView, DomainError>> {
    const theme = await this.deps.themes.get(input.tenantId);
    const s = theme.snapshot();
    const ids = [
      ...new Set([
        ...imageRefsOf(s.draft),
        ...(s.published === null ? [] : imageRefsOf(s.published)),
      ]),
    ];
    const images = ids.length === 0 ? {} : await this.deps.imageRefs.resolve(ids, input.tenantId);
    return ok({
      draft: s.draft,
      published: s.published,
      draftRevision: s.draftRevision,
      draftSavedAt: iso(s.draftSavedAt),
      publishedDraftRevision: s.publishedDraftRevision,
      releaseNumber: s.releaseNumber,
      publishedAt: iso(s.publishedAt),
      publishedBy: s.publishedBy,
      hasUnpublishedChanges: theme.hasUnpublishedChanges(),
      images,
      version: s.version,
    });
  }
}

/** Validate (document, contrast, image ownership) → then one unit of work with the version check. */
export class SaveThemeDraft {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly document: unknown;
    readonly expectedVersion: number;
    readonly tenantId: string;
  }): Promise<Result<SaveDraftView, DomainError>> {
    const validated = validateThemeDocument(input.document);
    if (!validated.ok) return err(invalidContent(validated.issues));
    const doc = validated.value;
    const contrast = checkBrandContrast(doc.brand.colors);
    if (contrast.blocking.length > 0) return err(invalidContent(contrast.blocking));
    const refs = imageRefsOf(doc);
    if (refs.length > 0) {
      const owned = await this.deps.imageRefs.existingIds(refs, input.tenantId);
      if (doc.brand.logo.imageRef !== null && !owned.includes(doc.brand.logo.imageRef))
        return err(imageNotFound(IMAGE_PATHS.logo));
      if (doc.brand.favicon.imageRef !== null && !owned.includes(doc.brand.favicon.imageRef))
        return err(imageNotFound(IMAGE_PATHS.favicon));
    }
    return inUnitOfWork(this.deps, async (tx) => {
      const theme = await this.deps.themes.get(input.tenantId, tx);
      if (theme.snapshot().version !== input.expectedVersion) return err(versionConflict());
      const version = theme.nextVersion;
      theme.saveDraft(doc, this.deps.clock.now());
      await this.deps.themes.save(theme, input.tenantId, tx);
      return ok({
        draftRevision: theme.snapshot().draftRevision,
        version,
        warnings: contrast.warnings,
      });
    });
  }
}

/** Spec 1.8: publish exactly the previewed revision; release + prune + event in the same transaction. */
export class PublishTheme {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly expectedDraftRevision: number;
    readonly by: string;
    readonly tenantId: string;
  }): Promise<Result<PublishView, DomainError>> {
    return inUnitOfWork(this.deps, async (tx) => {
      const theme = await this.deps.themes.get(input.tenantId, tx);
      const now = this.deps.clock.now();
      const release = theme.publish({
        expectedDraftRevision: input.expectedDraftRevision,
        by: input.by,
        releaseId: this.deps.idGenerator.generate(),
        now,
      });
      if (!release.ok) return release; // DRAFT_CHANGED / NOTHING_TO_PUBLISH — nothing written
      await this.deps.themes.save(theme, input.tenantId, tx);
      await this.deps.releases.append(release.value, input.tenantId, tx);
      await this.deps.releases.pruneBeyond(RELEASES_KEPT, input.tenantId, tx);
      await this.deps.events.record(
        [
          new ThemePublished(eventProps(this.deps, input.tenantId), {
            releaseNumber: release.value.releaseNumber,
          }),
        ],
        input.tenantId,
        tx,
      );
      return ok({ releaseNumber: release.value.releaseNumber, publishedAt: now.toISOString() });
    });
  }
}

async function rewriteDraft(
  deps: OnlineStoreDeps,
  input: { readonly expectedVersion: number; readonly tenantId: string },
  change: (theme: StorefrontTheme, tx: unknown) => Promise<Result<void, DomainError>>,
): Promise<Result<DraftRevisionView, DomainError>> {
  return inUnitOfWork(deps, async (tx) => {
    const theme = await deps.themes.get(input.tenantId, tx);
    if (theme.snapshot().version !== input.expectedVersion) return err(versionConflict());
    const version = theme.nextVersion;
    const changed = await change(theme, tx);
    if (!changed.ok) return changed;
    await deps.themes.save(theme, input.tenantId, tx);
    return ok({ draftRevision: theme.snapshot().draftRevision, version });
  });
}

export class DiscardThemeDraft {
  constructor(private readonly deps: OnlineStoreDeps) {}
  execute(input: {
    readonly expectedVersion: number;
    readonly tenantId: string;
  }): Promise<Result<DraftRevisionView, DomainError>> {
    return rewriteDraft(this.deps, input, (theme) => {
      theme.discardDraft(this.deps.clock.now());
      return Promise.resolve(ok(undefined));
    });
  }
}

/** Spec 1.8: restore goes into the DRAFT; publishing it is a separate step. */
export class RestoreThemeRelease {
  constructor(private readonly deps: OnlineStoreDeps) {}
  execute(input: {
    readonly releaseNumber: number;
    readonly expectedVersion: number;
    readonly tenantId: string;
  }): Promise<Result<DraftRevisionView, DomainError>> {
    return rewriteDraft(this.deps, input, async (theme, tx) => {
      const release = await this.deps.releases.get(input.releaseNumber, input.tenantId, tx);
      if (release === null) return err(releaseNotFound());
      theme.restoreRelease(release, this.deps.clock.now());
      return ok(undefined);
    });
  }
}

export class ListThemeReleases {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: { readonly tenantId: string }): Promise<Result<ReleasesView, DomainError>> {
    const releases = await this.deps.releases.list(input.tenantId, RELEASES_KEPT);
    // Ruling 12: no staff-directory name read exists on this base.
    return ok({
      releases: releases.map((r) => ({
        releaseNumber: r.releaseNumber,
        publishedAt: r.publishedAt.toISOString(),
        publishedByName: null,
      })),
    });
  }
}
