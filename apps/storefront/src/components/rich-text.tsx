import { createElement } from "react";
import { parseRichText, renderRichText, type RichTextTag } from "@platform/storefront-content";
import { cn } from "@platform/ui";

/** The look of each element the renderer may create (logical spacing, so RTL needs nothing more). */
const PROSE_CLASSES: Readonly<Partial<Record<RichTextTag, string>>> = {
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
 * Spec 2.8, Ruling 10: merchant text (policies, pages) as React elements. The stored text is always
 * parsed here, never taken pre-parsed from anywhere, and only the package renderer creates
 * elements: the allow-listed tags, text as plain children, every href checked again, `dir="auto"`
 * on each block. There is no HTML string anywhere on this path.
 */
export function RichText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("text-foreground", className)}>
      {renderRichText(parseRichText(text).document, createElement, PROSE_CLASSES)}
    </div>
  );
}
