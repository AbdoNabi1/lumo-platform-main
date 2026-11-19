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

/** What the view needs from other contexts. */
interface ViewContext {
  readonly storeName: string;
  readonly shareImage: ImageDto | null;
}

async function readViewContext(
  deps: OnlineStoreDeps,
  shareImageRef: string | null,
  tenantId: string,
): Promise<ViewContext> {
  const [storeName, images] = await Promise.all([
    deps.storeIdentity.storeName(tenantId),
    shareImageRef === null
      ? Promise.resolve<Readonly<Record<string, ImageDto>>>({})
      : deps.imageRefs.resolve([shareImageRef], tenantId),
  ]);
  return {
    storeName,
    shareImage: shareImageRef === null ? null : (images[shareImageRef] ?? null),
  };
}

function viewOf(
  prefs: StorefrontPreferences,
  context: ViewContext,
  version: number,
): PreferencesView {
  const s = prefs.snapshot();
  return {
    homeTitle: s.homeTitle,
    homeMetaDescription: s.homeMetaDescription,
    shareImage: context.shareImage,
    shareImageId: s.shareImageRef,
    defaultLocale: s.defaultLocale,
    storeName: context.storeName,
    version,
  };
}

export class GetPreferences {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<PreferencesView, DomainError>> {
    const prefs = await this.deps.preferences.get(input.tenantId);
    const s = prefs.snapshot();
    const context = await readViewContext(this.deps, s.shareImageRef, input.tenantId);
    return ok(viewOf(prefs, context, s.version));
  }
}

/**
 * Live on save (spec 1.4). Everything is validated, and the cross-context reads for the view are
 * done, before the unit of work writes anything: once it commits, this use case cannot fail.
 */
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
    const context = await readViewContext(this.deps, input.shareImageId, input.tenantId);
    return inUnitOfWork(this.deps, async (tx) => {
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
      return ok(viewOf(prefs, context, version));
    });
  }
}
