import {
  normalizeLocalizedText,
  pageHandleOfPath,
  RICH_TEXT_MAX,
  validateRichText,
  PAGE_META_DESCRIPTION_MAX,
  PAGE_TITLE_MAX,
  type ContentIssue,
  type LocalizedText,
} from "@platform/storefront-content";

/** A page's merchant text, per locale. Body is Morbeh rich text (see `renderRichText`). */
export interface PageContent {
  readonly title: LocalizedText;
  readonly body: LocalizedText;
  readonly metaDescription: LocalizedText;
}

export const EMPTY_PAGE_CONTENT: PageContent = { title: {}, body: {}, metaDescription: {} };

/** The handle of `/pages/<handle>` (the single rule lives in `@platform/storefront-content`). */
export const pageHandleOf = pageHandleOfPath;

/** Normalises and checks every field before anything is written. Absent fields are empty. */
export function validatePageContent(raw: {
  readonly title?: unknown;
  readonly body?: unknown;
  readonly metaDescription?: unknown;
}):
  | { readonly ok: true; readonly value: PageContent }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const title = normalizeLocalizedText(
    raw.title ?? {},
    { path: "title", max: PAGE_TITLE_MAX },
    issues,
  );
  const metaDescription = normalizeLocalizedText(
    raw.metaDescription ?? {},
    { path: "metaDescription", max: PAGE_META_DESCRIPTION_MAX },
    issues,
  );
  const body = normalizeLocalizedText(
    raw.body ?? {},
    { path: "body", max: RICH_TEXT_MAX.body, multiline: true },
    issues,
  );
  for (const locale of ["ar", "en"] as const) {
    const text = body[locale];
    if (text === undefined) continue;
    const path = `body.${locale}`;
    if (issues.some((issue) => issue.path === path)) continue;
    if (validateRichText(text, RICH_TEXT_MAX.body).length > 0) {
      issues.push({ path, code: "UNSAFE_LINK" });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { title, body, metaDescription } };
}
