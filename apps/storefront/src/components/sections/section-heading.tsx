import { pickText, type LocalizedText } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";

/** A section's heading: an `h2` in the request locale (or the other one); nothing when empty. */
export function SectionHeading({
  text,
  locale,
  id,
}: {
  readonly text: LocalizedText;
  readonly locale: Locale;
  readonly id: string;
}) {
  const picked = pickText(text, locale);
  if (picked === null) return null;
  return (
    <h2 id={`${id}-heading`} dir="auto" className="break-words text-lg font-semibold">
      {picked}
    </h2>
  );
}
