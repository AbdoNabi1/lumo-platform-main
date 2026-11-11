import {
  checkBrandContrast,
  DEFAULT_THEME_DOCUMENT,
  documentRefsOf,
  imageRefsOf,
  MAX_ISSUES,
  validateThemeDocument,
  type ContentIssue,
  type ContrastWarning,
  type SectionRef,
  type SectionRefs,
  type ThemeDocument,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import { logger, type DomainError } from "@platform/utils";
import {
  invalidContent,
  referencesNotFound,
  releaseNotFound,
  versionConflict,
} from "../domain/errors";
import { ThemePublished } from "../domain/events";
import { RELEASES_KEPT, type StorefrontTheme } from "../domain/storefront-theme";
import type { OnlineStoreDeps } from "./deps";
import { eventProps, inUnitOfWork, iso } from "./guarded";
import type { CatalogLinkType, ImageDto, LinkTargetMap } from "./ports";

/** What the editor knows of each collection, product and page the draft names (Ruling 21). */
export type ThemeTargetsView = Readonly<
  Record<
    CatalogLinkType,
    Readonly<Record<string, { readonly title: string; readonly live: boolean }>>
  >
>;

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
  /** `null` when the targets read failed: the editor then flags nothing as removed. */
  readonly targets: ThemeTargetsView | null;
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

const LINK_KINDS: readonly CatalogLinkType[] = ["collection", "product", "page"];

const distinctIds = (refs: readonly SectionRef[]): string[] => [
  ...new Set(refs.map((ref) => ref.id)),
];

const linkIdsOf = (refs: SectionRefs): Record<CatalogLinkType, string[]> => ({
  collection: distinctIds(refs.collection),
  product: distinctIds(refs.product),
  page: distinctIds(refs.page),
});

const hasLinkIds = (ids: Readonly<Record<CatalogLinkType, readonly string[]>>): boolean =>
  LINK_KINDS.some((kind) => ids[kind].length > 0);

/** The references in `doc` whose id no `known` document names, per kind, in document order. */
function freshRefs(doc: ThemeDocument, known: readonly ThemeDocument[]): SectionRefs {
  const refs = documentRefsOf(doc);
  const knownRefs = known.map(documentRefsOf);
  const fresh = (kind: keyof SectionRefs): SectionRef[] => {
    const ids = new Set(knownRefs.flatMap((k) => k[kind].map((ref) => ref.id)));
    return refs[kind].filter((ref) => !ids.has(ref.id));
  };
  return {
    image: fresh("image"),
    collection: fresh("collection"),
    product: fresh("product"),
    page: fresh("page"),
  };
}

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
    // In parallel: `targetsOf` never throws, so a failed image read fails the read as before.
    const [images, targets] = await Promise.all([
      ids.length === 0 ? {} : this.deps.imageRefs.resolve(ids, input.tenantId),
      this.targetsOf(s.draft, input.tenantId),
    ]);
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
      targets,
      version: s.version,
    });
  }

  /**
   * One batched resolve of the draft's collections, products and pages (none when it names none).
   * A failed read is `null`, logged with the tenant and the message only, so a catalogue blip
   * never shows a reference as removed.
   */
  private async targetsOf(
    draft: ThemeDocument,
    tenantId: string,
  ): Promise<ThemeTargetsView | null> {
    const ids = linkIdsOf(documentRefsOf(draft));
    let resolved: LinkTargetMap;
    try {
      resolved = hasLinkIds(ids)
        ? await this.deps.linkTargets.resolve(ids, tenantId)
        : { collection: {}, product: {}, page: {} };
    } catch (error) {
      logger.warn("online-store theme: link targets unavailable", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    // `Object.fromEntries` defines own keys, so an id such as `__proto__` stays a plain entry.
    const view = (kind: CatalogLinkType) =>
      Object.fromEntries(
        ids[kind].flatMap((id) => {
          const target = Object.hasOwn(resolved[kind], id) ? resolved[kind][id] : undefined;
          return target === undefined
            ? []
            : [[id, { title: target.title, live: target.published }]];
        }),
      );
    return { collection: view("collection"), product: view("product"), page: view("page") };
  }
}

/**
 * Validate the document and contrast → read the row and check the version → check only the NEW
 * references (Ruling 6) → one unit of work that re-checks the version. Every refusal comes before
 * the first write, because the unit of work commits on an `err` Result.
 */
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
    // A stale tab answers before any reference read. The known references come from this same
    // row, which the unit of work below re-checks by version.
    const current = (await this.deps.themes.get(input.tenantId)).snapshot();
    if (current.version !== input.expectedVersion) return err(versionConflict());
    const fresh = freshRefs(doc, [current.draft, current.published ?? DEFAULT_THEME_DOCUMENT]);
    const missing = await this.missingRefs(fresh, input.tenantId);
    if (missing.length > 0) return err(referencesNotFound(missing));
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

  /**
   * Fresh images through Media's ownership read, fresh links through one batched resolve (an id
   * absent from the map is not this shop's). Images first, then collections, products and pages,
   * each in document order. A failed read throws: a 500 that autosave retries, never a 422.
   */
  private async missingRefs(fresh: SectionRefs, tenantId: string): Promise<ContentIssue[]> {
    const issues: ContentIssue[] = [];
    const imageIds = distinctIds(fresh.image);
    if (imageIds.length > 0) {
      const owned = new Set(await this.deps.imageRefs.existingIds(imageIds, tenantId));
      for (const ref of fresh.image)
        if (!owned.has(ref.id)) issues.push({ path: ref.path, code: "IMAGE_NOT_FOUND" });
    }
    const linkIds = linkIdsOf(fresh);
    if (hasLinkIds(linkIds)) {
      const found = await this.deps.linkTargets.resolve(linkIds, tenantId);
      for (const kind of LINK_KINDS)
        for (const ref of fresh[kind])
          if (!Object.hasOwn(found[kind], ref.id))
            issues.push({ path: ref.path, code: "TARGET_NOT_FOUND" });
    }
    return issues.slice(0, MAX_ISSUES);
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
