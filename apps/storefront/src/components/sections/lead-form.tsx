import { pickText, type PublicSection } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { LeadFormFields } from "./lead-form-fields";
import { SectionHeading } from "./section-heading";

type LeadFormData = Extract<PublicSection, { type: "lead_form"; incomplete?: never }>;

/**
 * The lead form section: heading, intro text and the client form. Only the strings it needs cross
 * to the client (the form's own copy and the two resolved texts), never the whole dictionary.
 * `Sections` renders it on lead sites only; the visitor's entry goes to the `submitLead` action,
 * which takes the shop from the request, never from the form.
 */
export function LeadFormSection({
  section,
  locale,
  t,
}: {
  readonly section: LeadFormData;
  readonly locale: Locale;
  readonly t: Dictionary;
}) {
  const s = section.settings;
  const text = pickText(s.text, locale);
  const hasHeading = pickText(s.heading, locale) !== null;
  return (
    <div className="border-border bg-card mx-auto flex w-full max-w-xl flex-col gap-4 rounded-lg border p-6 text-start">
      <SectionHeading text={s.heading} locale={locale} id={section.id} />
      {text === null ? null : (
        <p dir="auto" className="text-muted-foreground break-words text-sm">
          {text}
        </p>
      )}
      <LeadFormFields
        formId={section.id}
        locale={locale}
        copy={t.leadForm}
        submitLabel={pickText(s.submitLabel, locale) ?? t.leadForm.submitDefault}
        successMessage={pickText(s.successMessage, locale) ?? t.leadForm.successDefault}
        showEmail={s.showEmail}
        showMessage={s.showMessage}
        labelledBy={hasHeading ? `${section.id}-heading` : undefined}
      />
    </div>
  );
}
