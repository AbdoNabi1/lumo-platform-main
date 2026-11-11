import {
  isWhatsAppDigits,
  pickText,
  whatsAppHref,
  type PublicSection,
} from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SectionHeading } from "./section-heading";
import { BUTTON_CLASS } from "./section-styles";

type WhatsAppData = Extract<PublicSection, { type: "whatsapp_cta"; incomplete?: never }>;

/**
 * A "message us" button. This is the one href that does not go through `safeHref` (F23): it is
 * built by `whatsAppHref` as `https://wa.me/<digits>` after `isWhatsAppDigits` has checked the
 * digits again, so nothing a merchant typed is in it but digits and a URL-encoded message. It
 * never carries the preview token, and it opens in a new tab without an opener or a referrer.
 */
export function WhatsAppCtaSection({
  section,
  locale,
  t,
}: {
  readonly section: WhatsAppData;
  readonly locale: Locale;
  readonly t: Dictionary;
}) {
  const s = section.settings;
  if (!isWhatsAppDigits(s.phone)) return null;
  const href = whatsAppHref(s.phone, pickText(s.message, locale));
  if (href === null) return null;
  const label = pickText(s.buttonLabel, locale);
  const text = pickText(s.text, locale);
  return (
    <div className="border-border bg-card mx-auto flex w-full max-w-3xl flex-col items-center gap-3 rounded-lg border p-6 text-center">
      <SectionHeading text={s.heading} locale={locale} id={section.id} />
      {text === null ? null : (
        <p dir="auto" className="text-muted-foreground break-words text-sm">
          {text}
        </p>
      )}
      {label === null ? null : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={BUTTON_CLASS.primary}
        >
          <bdi dir="auto">{label}</bdi>
          <span className="sr-only">{t.sections.opensInNewTab}</span>
        </a>
      )}
    </div>
  );
}
