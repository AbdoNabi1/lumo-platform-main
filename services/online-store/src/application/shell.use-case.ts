import {
  DEFAULT_THEME_DOCUMENT,
  readSocial,
  type Locale,
  type LocalizedText,
  type ThemeBrand,
} from "@platform/storefront-content";
import type { OnlineStoreDeps } from "./deps";
import type { ImageDto } from "./ports";
import type { ResolvePreviewToken } from "./preview.use-cases";

/** Spec 1.10 `PublicShellDto` (+ `branded`, Ruling 6). No tenant, key, revision, hash or version. */
export interface PublicShellView {
  readonly mode: "live" | "preview";
  /** The preview link's expiry (ISO) for the preview banner; null when live. */
  readonly previewExpiresAt: string | null;
  readonly branded: boolean;
  readonly storeName: string;
  readonly defaultLocale: Locale;
  readonly preferences: {
    readonly homeTitle: LocalizedText;
    readonly homeMetaDescription: LocalizedText;
    readonly shareImage: ImageDto | null;
  };
  readonly brand: {
    readonly logo: { readonly image: ImageDto | null; readonly widthPx: number };
    readonly favicon: ImageDto | null;
    readonly colors: ThemeBrand["colors"];
    readonly typography: ThemeBrand["typography"];
    readonly corners: ThemeBrand["corners"];
    readonly social: ThemeBrand["social"];
  };
  readonly header: { readonly sticky: boolean };
  readonly footer: { readonly note: LocalizedText; readonly showSocial: boolean };
  readonly locked: boolean;
}

export type ShellOutcome =
  { readonly kind: "ok"; readonly shell: PublicShellView } | { readonly kind: "preview_invalid" };

export class GetStorefrontShell {
  constructor(
    private readonly deps: OnlineStoreDeps,
    private readonly resolvePreview: ResolvePreviewToken,
  ) {}

  async execute(input: {
    readonly tenantId: string;
    readonly previewToken?: string;
  }): Promise<ShellOutcome> {
    const preview = input.previewToken !== undefined;
    const expiresAt = preview
      ? await this.resolvePreview.execute({
          token: input.previewToken,
          tenantId: input.tenantId,
        })
      : null;
    if (preview && expiresAt === null) return { kind: "preview_invalid" };
    const [theme, prefs, access, storeName] = await Promise.all([
      this.deps.themes.get(input.tenantId),
      this.deps.preferences.get(input.tenantId),
      this.deps.access.get(input.tenantId),
      this.deps.storeIdentity.storeName(input.tenantId),
    ]);
    const t = theme.snapshot();
    const doc = preview ? t.draft : (t.published ?? DEFAULT_THEME_DOCUMENT);
    const p = prefs.snapshot();
    const ids = [doc.brand.logo.imageRef, doc.brand.favicon.imageRef, p.shareImageRef].filter(
      (id): id is string => id !== null,
    );
    const images =
      ids.length === 0 ? {} : await this.deps.imageRefs.resolve([...new Set(ids)], input.tenantId);
    const image = (id: string | null): ImageDto | null =>
      id === null ? null : (images[id] ?? null);
    return {
      kind: "ok",
      shell: {
        mode: preview ? "preview" : "live",
        previewExpiresAt: expiresAt === null ? null : expiresAt.toISOString(),
        branded: preview || t.published !== null,
        storeName,
        defaultLocale: p.defaultLocale,
        preferences: {
          homeTitle: p.homeTitle,
          homeMetaDescription: p.homeMetaDescription,
          shareImage: image(p.shareImageRef),
        },
        brand: {
          logo: { image: image(doc.brand.logo.imageRef), widthPx: doc.brand.logo.widthPx },
          favicon: image(doc.brand.favicon.imageRef),
          colors: doc.brand.colors,
          typography: doc.brand.typography,
          corners: doc.brand.corners,
          social: readSocial(doc.brand.social),
        },
        header: { sticky: doc.header.sticky },
        footer: { note: doc.footer.note, showSocial: doc.footer.showSocial },
        locked: access.snapshot().locked,
      },
    };
  }
}
