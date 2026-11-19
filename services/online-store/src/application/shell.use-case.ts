import {
  DEFAULT_THEME_DOCUMENT,
  isDefaultMenuHandle,
  menuHandlesOf,
  POLICY_TYPES,
  readSocial,
  type AnnouncementSection,
  type Locale,
  type LocalizedText,
  type MenuItem,
  type PolicyType,
  type PublicAnnouncement,
  type ResolvedMenuItem,
  type ThemeBrand,
  type ThemeDocument,
} from "@platform/storefront-content";
import { logger } from "@platform/utils";
import { virtualDefaultMenu } from "../domain/default-menus";
import type { OnlineStoreDeps } from "./deps";
import { emptyTargets, loadTargets, resolveItems } from "./menu-resolution";
import type { ImageDto, LinkTargetMap } from "./ports";
import type { ResolvePreviewToken } from "./preview.use-cases";
import { resolveSection } from "./section-resolution";

/**
 * The bar as the storefront gets it (Ruling 25): complete only, in both modes, since the header
 * has no placeholder. Live drops a hidden bar; preview keeps it, flagged `hidden`.
 */
function announcementOf(
  bar: AnnouncementSection | null,
  targets: LinkTargetMap,
  setPolicies: ReadonlySet<PolicyType>,
  mode: "live" | "preview",
): PublicAnnouncement | null {
  if (bar === null) return null;
  const resolved = resolveSection(bar, { images: {}, targets, setPolicies }, mode);
  return resolved !== null && resolved.type === "announcement_bar" && resolved.incomplete !== true
    ? resolved
    : null;
}

/** The bar's link as a one-item pseudo-menu, so it joins the menus' single targets read. */
function barLinkItems(bar: AnnouncementSection | null): MenuItem[] {
  return bar === null || bar.settings.link === null
    ? []
    : [{ id: bar.id, label: {}, link: bar.settings.link, children: [] }];
}

/**
 * Spec 1.10 `PublicShellDto` (+ `branded`, Ruling 6). No tenant, storage key, revision, hash or
 * version field. An image `url` is the public CDN url, whose path does hold the storage key
 * (`tenants/<id>/...`), as for product images.
 */
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
  /** Spec 2.2: menus resolved live; only display fields and canonical safe hrefs. */
  readonly header: {
    readonly sticky: boolean;
    readonly menu: readonly ResolvedMenuItem[];
    /** Part 3: the announcement bar resolved; null when there is none to show. */
    readonly announcement: PublicAnnouncement | null;
  };
  readonly footer: {
    readonly note: LocalizedText;
    readonly showSocial: boolean;
    readonly menu: readonly ResolvedMenuItem[];
    /** The set policies in POLICY_TYPES order when `showPolicyLinks`, else none. */
    readonly policies: readonly PolicyType[];
  };
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
    const mode = preview ? "preview" : "live";
    // A hidden bar is never looked up live (Ruling 25).
    const stored = doc.header.announcement;
    const bar = stored !== null && (preview || !stored.hidden) ? stored : null;
    const ids = [doc.brand.logo.imageRef, doc.brand.favicon.imageRef, p.shareImageRef].filter(
      (id): id is string => id !== null,
    );
    // Images and menus in parallel; the link targets (menus and bar, one read) need the menus.
    const [images, { menus, targets }] = await Promise.all([
      this.imagesOf(ids, input.tenantId),
      this.menusOf(doc, input.tenantId).then(async (menus) => ({
        menus,
        targets: await this.targetsOf(
          [...menus.header, ...menus.footer, ...barLinkItems(bar)],
          input.tenantId,
        ),
      })),
    ]);
    const setPolicies = new Set(menus.setPolicies);
    const image = (id: string | null): ImageDto | null =>
      id === null ? null : (images[id] ?? null);
    return {
      kind: "ok",
      shell: {
        mode,
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
        header: {
          sticky: doc.header.sticky,
          menu: resolveItems(menus.header, targets, setPolicies),
          announcement: announcementOf(bar, targets, setPolicies, mode),
        },
        footer: {
          note: doc.footer.note,
          showSocial: doc.footer.showSocial,
          menu: resolveItems(menus.footer, targets, setPolicies),
          policies: doc.footer.showPolicyLinks ? menus.setPolicies : [],
        },
        locked: access.snapshot().locked,
      },
    };
  }

  /**
   * The header and footer menus the document names: the saved menu, else the virtual default for
   * a default handle, else nothing. One read per distinct handle (at most two) and one policy list.
   */
  private async menusOf(
    doc: ThemeDocument,
    tenantId: string,
  ): Promise<{
    readonly header: readonly MenuItem[];
    readonly footer: readonly MenuItem[];
    readonly setPolicies: readonly PolicyType[];
  }> {
    const handles = menuHandlesOf(doc);
    const [saved, policies] = await Promise.all([
      Promise.all(handles.map((handle) => this.deps.menus.get(handle, tenantId))),
      this.deps.policies.list(tenantId),
    ]);
    const setPolicies = POLICY_TYPES.filter((type) =>
      policies.some((policy) => policy.snapshot().type === type && policy.isSet),
    );
    const itemsOf = (handle: string): readonly MenuItem[] => {
      const menu = saved[handles.indexOf(handle)] ?? null;
      if (menu !== null) return menu.snapshot().items;
      return isDefaultMenuHandle(handle)
        ? virtualDefaultMenu(handle, setPolicies).snapshot().items
        : [];
    };
    return {
      header: itemsOf(doc.header.menuHandle),
      footer: itemsOf(doc.footer.menuHandle),
      setPolicies,
    };
  }

  /**
   * One batched read for both menus. When it fails the shell still answers: catalogue and page
   * links drop out (no target is live), and home, search, policy and URL links stay (Ruling 26).
   */
  private async targetsOf(items: readonly MenuItem[], tenantId: string): Promise<LinkTargetMap> {
    try {
      return await loadTargets(this.deps, items, tenantId);
    } catch (error) {
      logger.warn("storefront shell: link targets unavailable", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return emptyTargets();
    }
  }

  /**
   * Images are optional in the shell too, so a failed read blanks them and keeps the rest.
   * Only here: the admin reads use the same port, where a blip must not look like a removed image.
   */
  private async imagesOf(
    ids: readonly string[],
    tenantId: string,
  ): Promise<Readonly<Record<string, ImageDto>>> {
    if (ids.length === 0) return {};
    try {
      return await this.deps.imageRefs.resolve([...new Set(ids)], tenantId);
    } catch (error) {
      logger.warn("storefront shell: images unavailable", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }
}
