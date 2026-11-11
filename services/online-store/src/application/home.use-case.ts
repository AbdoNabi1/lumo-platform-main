import { DEFAULT_THEME_DOCUMENT, type PublicSection } from "@platform/storefront-content";
import type { OnlineStoreDeps } from "./deps";
import type { ResolvePreviewToken } from "./preview.use-cases";
import { loadResolutionContext, resolveSections } from "./section-resolution";

/**
 * Spec 3.4: the homepage's sections, references resolved (Ruling 13). No tenant, image ref,
 * storage key, revision or removed id; an unknown section type is never served.
 */
export interface PublicHomeView {
  readonly mode: "live" | "preview";
  readonly sections: readonly PublicSection[];
}

export type HomeOutcome =
  { readonly kind: "ok"; readonly home: PublicHomeView } | { readonly kind: "preview_invalid" };

export class GetStorefrontHome {
  constructor(
    private readonly deps: OnlineStoreDeps,
    private readonly resolvePreview: ResolvePreviewToken,
  ) {}

  async execute(input: {
    readonly tenantId: string;
    readonly previewToken?: string;
  }): Promise<HomeOutcome> {
    // Exactly the shell's check: a present token must be this shop's, unexpired, else no draft.
    const preview = input.previewToken !== undefined;
    const expiresAt = preview
      ? await this.resolvePreview.execute({
          token: input.previewToken,
          tenantId: input.tenantId,
        })
      : null;
    if (preview && expiresAt === null) return { kind: "preview_invalid" };
    const theme = (await this.deps.themes.get(input.tenantId)).snapshot();
    const doc = preview ? theme.draft : (theme.published ?? DEFAULT_THEME_DOCUMENT);
    const mode = preview ? "preview" : "live";
    // Live never loads a hidden section's references; preview shows them, flagged.
    const sections = preview
      ? doc.homepage.sections
      : doc.homepage.sections.filter((section) => !section.hidden);
    const ctx = await loadResolutionContext(this.deps, sections, input.tenantId);
    return { kind: "ok", home: { mode, sections: resolveSections(sections, ctx, mode) } };
  }
}
