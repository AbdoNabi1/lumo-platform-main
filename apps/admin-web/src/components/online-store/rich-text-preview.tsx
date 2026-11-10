import { createElement, type ReactElement } from "react";
import {
  parseRichText,
  renderRichText,
  type CreateElement,
  type RichTextTag,
} from "@platform/storefront-content";

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

const NEW_TAB_REL = "noopener noreferrer";

/**
 * Morbeh text as the storefront renders it (Ruling 10): the stored text is always parsed here and
 * only the package renderer creates elements (the allow-listed tags, text as plain children, every
 * href checked again, `dir="auto"` on each block). There is no HTML string anywhere on this path.
 *
 * The one admin difference (review M-3): a link the storefront opens in the same tab opens in a
 * new tab here, so a click in Preview never navigates the admin away from unsaved edits. A shop
 * path (always one leading `/`, the renderer's canonical form) is put on `linkBase`, the
 * storefront's address, when there is one.
 */
export function RichTextPreview({
  text,
  linkBase = null,
}: {
  readonly text: string;
  readonly linkBase?: string | null;
}) {
  const base = linkBase?.trim().replace(/\/+$/, "") ?? "";
  const h: CreateElement<ReactElement> = (tag, props, ...children) => {
    if (tag !== "a" || props.target !== undefined) return createElement(tag, props, ...children);
    const href =
      base !== "" && props.href?.startsWith("/") === true ? `${base}${props.href}` : props.href;
    return createElement(tag, { ...props, href, target: "_blank", rel: NEW_TAB_REL }, ...children);
  };
  return <>{renderRichText(parseRichText(text).document, h, ADMIN_PROSE_CLASSES)}</>;
}
