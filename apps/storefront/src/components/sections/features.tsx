import {
  BadgeCheckIcon,
  BanknoteIcon,
  GiftIcon,
  HeadsetIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TruckIcon,
  type LucideIcon,
} from "lucide-react";
import { pickText, type FeatureIcon, type PublicSection } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SectionHeading } from "./section-heading";

type FeaturesData = Extract<PublicSection, { type: "features"; incomplete?: never }>;

/** The fixed icon for each key a merchant can pick; they are decorative. */
export const FEATURE_ICON_COMPONENTS: Readonly<Record<FeatureIcon, LucideIcon>> = {
  cod: BanknoteIcon,
  shipping: TruckIcon,
  returns: RotateCcwIcon,
  support: HeadsetIcon,
  secure: ShieldCheckIcon,
  quality: BadgeCheckIcon,
  gift: GiftIcon,
};

/** Store highlights: an icon, a title and a line of text each. */
export function FeaturesSection({
  section,
  locale,
}: {
  readonly section: FeaturesData;
  readonly locale: Locale;
  readonly t: Dictionary;
}) {
  const s = section.settings;
  return (
    <>
      <SectionHeading text={s.heading} locale={locale} id={section.id} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {s.items.map((item, index) => {
          const title = pickText(item.title, locale);
          const text = pickText(item.text, locale);
          if (title === null && text === null) return null;
          const Icon = FEATURE_ICON_COMPONENTS[item.icon] ?? FEATURE_ICON_COMPONENTS.quality;
          return (
            <div
              key={index}
              className="border-border bg-card flex items-start gap-3 rounded-lg border p-4"
            >
              <Icon aria-hidden="true" className="text-primary mt-0.5 size-6 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                {title === null ? null : (
                  <p dir="auto" className="break-words text-sm font-medium">
                    {title}
                  </p>
                )}
                {text === null ? null : (
                  <p dir="auto" className="text-muted-foreground break-words text-sm">
                    {text}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
