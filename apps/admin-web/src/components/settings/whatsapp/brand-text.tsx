import { Fragment } from "react";

/** The brand names the admin copy may contain. Each sits in its own `<bdi dir="auto">` so neither direction mangles it. */
const BRANDS = /\b(WhatsApp|Meta)\b/;

/**
 * Renders dictionary copy with every brand name isolated (`<bdi dir="auto">`). Copy without a brand name renders as
 * plain text.
 */
export function BrandText({ text }: { readonly text: string }) {
  const parts = text.split(new RegExp(BRANDS, "g"));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <bdi key={index} dir="auto">
            {part}
          </bdi>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
