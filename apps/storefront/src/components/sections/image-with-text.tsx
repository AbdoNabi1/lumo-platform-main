import Image from "next/image";
import { pickText, type PublicSection } from "@platform/storefront-content";
import { RichText } from "@/components/rich-text";
import type { Locale } from "@/lib/i18n";
import { safeImageSrc } from "@/lib/safe-image";
import type { Dictionary } from "@/messages/en";
import { SectionButton } from "./section-button";
import { SectionHeading } from "./section-heading";

type ImageWithTextData = Extract<PublicSection, { type: "image_with_text"; incomplete?: never }>;

/**
 * A picture beside a heading, a rich-text body and a button. `md:order-last` is a logical order, so
 * "end" flips with the reading direction. The body goes through `<RichText>`, never as HTML.
 */
export function ImageWithTextSection({
  section,
  locale,
  previewToken,
}: {
  readonly section: ImageWithTextData;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly t: Dictionary;
}) {
  const s = section.settings;
  const src = s.image === null ? null : safeImageSrc(s.image.url);
  const body = pickText(s.body, locale);
  const hasText = pickText(s.heading, locale) !== null || body !== null || s.button !== null;
  return (
    <div className="grid items-center gap-6 md:grid-cols-2">
      {s.image === null || src === null ? null : (
        <div
          className={`bg-muted relative aspect-[4/3] overflow-hidden rounded-lg ${
            s.imagePosition === "end" ? "md:order-last" : ""
          }`}
        >
          <Image
            src={src}
            alt={s.image.alt ?? ""}
            fill
            unoptimized
            loading="lazy"
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      )}
      {hasText ? (
        <div className="flex flex-col items-start gap-3">
          <SectionHeading text={s.heading} locale={locale} id={section.id} />
          {body === null ? null : <RichText text={body} className="break-words" />}
          {s.button === null ? null : (
            <SectionButton button={s.button} locale={locale} previewToken={previewToken} />
          )}
        </div>
      ) : null}
    </div>
  );
}
