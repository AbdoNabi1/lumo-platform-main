import { createElement } from "react";
import { parseRichText, renderRichText, type RichTextTag } from "@platform/storefront-content";

/**
 * The look of each element, equal to the storefront's `PROSE_CLASSES`
 * (`apps/storefront/src/components/rich-text.tsx`), so Preview shows what customers see. Ruling 10
 * accepts the copy: Tailwind does not scan workspace packages, so each app keeps its own map.
 */
export const ADMIN_PROSE_CLASSES: Readonly<Partial<Record<RichTextTag, string>>> = {
  h2: "mt-8 mb-3 text-xl font-semibold",
  h3: "mt-6 mb-2 text-lg font-semibold",
  p: "my-3 leading-7",
  ul: "my-3 list-disc ps-6",
  ol: "my-3 list-decimal ps-6",
  li: "my-1",
  a: "text-primary underline underline-offset-4",
  hr: "border-border my-8",
};

/**
 * Morbeh text as the storefront renders it (Ruling 10): the stored text is always parsed here and
 * only the package renderer creates elements (the allow-listed tags, text as plain children, every
 * href checked again, `dir="auto"` on each block). There is no HTML string anywhere on this path.
 */
export function RichTextPreview({ text }: { readonly text: string }) {
  return <>{renderRichText(parseRichText(text).document, createElement, ADMIN_PROSE_CLASSES)}</>;
}
