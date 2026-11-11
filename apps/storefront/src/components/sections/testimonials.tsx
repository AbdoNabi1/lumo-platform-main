import { pickText, type PublicSection } from "@platform/storefront-content";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SectionHeading } from "./section-heading";

type TestimonialsData = Extract<PublicSection, { type: "testimonials"; incomplete?: never }>;

const MAX_RATING = 5;

/** Quotes that stack on mobile. Stars are decorative; the rating is said once, to screen readers. */
export function TestimonialsSection({
  section,
  locale,
  t,
}: {
  readonly section: TestimonialsData;
  readonly locale: Locale;
  readonly t: Dictionary;
}) {
  const s = section.settings;
  return (
    <>
      <SectionHeading text={s.heading} locale={locale} id={section.id} />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {s.items.map((item, index) => {
          const quote = pickText(item.quote, locale);
          if (quote === null) return null;
          const rating = Number.isFinite(item.rating)
            ? Math.min(MAX_RATING, Math.max(0, Math.round(item.rating)))
            : 0;
          const author = item.author.trim();
          return (
            <figure
              key={index}
              className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4"
            >
              {rating === 0 ? null : (
                <>
                  <span aria-hidden="true" className="text-lg">
                    {"★".repeat(rating)}
                  </span>
                  <span className="sr-only">
                    {t.sections.rating
                      .replace("{rating}", formatNumber(locale, rating))
                      .replace("{max}", formatNumber(locale, MAX_RATING))}
                  </span>
                </>
              )}
              <blockquote dir="auto" className="break-words text-sm">
                {quote}
              </blockquote>
              {author === "" ? null : (
                <figcaption className="text-muted-foreground break-words text-xs">
                  <bdi dir="auto">{author}</bdi>
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
    </>
  );
}
