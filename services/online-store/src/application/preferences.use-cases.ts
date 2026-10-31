import {
  normalizeLocalizedText,
  type ContentIssue,
  type Locale,
  type LocalizedText,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { imageNotFound, invalidContent, versionConflict } from "../domain/errors";
import { PreferencesUpdated } from "../domain/events";
import {
  HOME_DESCRIPTION_MAX,
  HOME_TITLE_MAX,
  type StorefrontPreferences,
} from "../domain/storefront-preferences";
import type { OnlineStoreDeps } from "./deps";
import { eventProps, inUnitOfWork } from "./guarded";
import type { ImageDto } from "./ports";

export interface PreferencesView {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  readonly shareImage: ImageDto | null;
  /** The stored ref: `ImageDto` carries no id, and the form must send it back on save. */
  readonly shareImageId: string | null;
  readonly defaultLocale: Locale;
  readonly storeName: string;
  readonly version: number;
}

export interface UpdatePreferencesInput {
  readonly homeTitle: unknown;
  readonly homeMetaDescription: unknown;
  readonly shareImageId: string | null;
  readonly defaultLocale: Locale;
  readonly expectedVersion: number;
  readonly tenantId: string;
}

async function viewOf(
  deps: OnlineStoreDeps,
  prefs: StorefrontPreferences,
  tenantId: string,
  version: number,
): Promise<PreferencesView> {
  const s = prefs.snapshot();
  const [storeName, images] = await Promise.all([
    deps.storeIdentity.storeName(tenantId),
    s.shareImageRef === null
      ? Promise.resolve({})
      : deps.imageRefs.resolve([s.shareImageRef], tenantId),
  ]);
  return {
    homeTitle: s.homeTitle,
    homeMetaDescription: s.homeMetaDescription,
    shareImage:
      s.shareImageRef === null
        ? null
        : ((images as Record<string, ImageDto>)[s.shareImageRef] ?? null),
    shareImageId: s.shareImageRef,
    defaultLocale: s.defaultLocale,
    storeName,
    version,
  };
}

export class GetPreferences {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<PreferencesView, DomainError>> {
    const prefs = await this.deps.preferences.get(input.tenantId);
    return ok(await viewOf(this.deps, prefs, input.tenantId, prefs.snapshot().version));
  }
}

/** Live on save (spec 1.4). Everything is validated before the unit of work writes anything. */
export class UpdatePreferences {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: UpdatePreferencesInput): Promise<Result<PreferencesView, DomainError>> {
    const issues: ContentIssue[] = [];
    const homeTitle = normalizeLocalizedText(
      input.homeTitle,
      { path: "homeTitle", max: HOME_TITLE_MAX },
      issues,
    );
    const homeMetaDescription = normalizeLocalizedText(
      input.homeMetaDescription,
      { path: "homeMetaDescription", max: HOME_DESCRIPTION_MAX },
      issues,
    );
    if (issues.length > 0) return err(invalidContent(issues));
    if (input.shareImageId !== null) {
      const owned = await this.deps.imageRefs.existingIds([input.shareImageId], input.tenantId);
      if (!owned.includes(input.shareImageId)) return err(imageNotFound("shareImageId"));
    }
    const saved = await inUnitOfWork(this.deps, async (tx) => {
      const prefs = await this.deps.preferences.get(input.tenantId, tx);
      if (prefs.snapshot().version !== input.expectedVersion) return err(versionConflict());
      const version = prefs.nextVersion;
      prefs.update(
        {
          homeTitle,
          homeMetaDescription,
          shareImageRef: input.shareImageId,
          defaultLocale: input.defaultLocale,
        },
        this.deps.clock.now(),
      );
      await this.deps.preferences.save(prefs, input.tenantId, tx);
      await this.deps.events.record(
        [new PreferencesUpdated(eventProps(this.deps, input.tenantId))],
        input.tenantId,
        tx,
      );
      return ok({ prefs, version });
    });
    if (!saved.ok) return saved;
    return ok(await viewOf(this.deps, saved.value.prefs, input.tenantId, saved.value.version));
  }
}
