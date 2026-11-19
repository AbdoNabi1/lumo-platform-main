import { pickText, type PublicSection } from "@platform/storefront-content";
import { RichText } from "@/components/rich-text";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SectionButton } from "./section-button";
import { SectionHeading } from "./section-heading";
import { ALIGN_CLASSES } from "./section-styles";

type RichTextData = Extract<PublicSection, { type: "rich_text"; incomplete?: never }>;

/** A heading, a rich-text body (through `<RichText>`) and an optional button. */
export function RichTextSection({
  section,
  locale,
  previewToken,
}: {
  readonly section: RichTextData;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly t: Dictionary;
}) {
  const s = section.settings;
  const body = pickText(s.body, locale);
  return (
    <div className={`mx-auto flex w-full max-w-3xl flex-col gap-3 ${ALIGN_CLASSES[s.align]}`}>
      <SectionHeading text={s.heading} locale={locale} id={section.id} />
      {body === null ? null : <RichText text={body} className="w-full break-words" />}
      {s.button === null ? null : (
        <SectionButton button={s.button} locale={locale} previewToken={previewToken} />
      )}
    </div>
  );
}
