import { CollectionCard } from "@/components/collection-card";
import type { Locale } from "@/lib/i18n";
import type { HomeCollection } from "@/lib/section-data";
import type { Dictionary } from "@/messages/en";
import { SectionHeading } from "./section-heading";
import { columnsClass } from "./section-styles";
import type { Settings } from "./section-types";

export function CollectionList({
  id,
  settings,
  collections,
  t,
  locale,
}: {
  readonly id: string;
  readonly settings: Settings<"collection_list">;
  readonly collections: readonly HomeCollection[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <>
      <SectionHeading text={settings.heading} locale={locale} id={id} />
      {collections.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.home.collectionsEmpty}</p>
      ) : (
        <div className={`grid gap-3 ${columnsClass(settings.columns)}`}>
          {/* Keyed by position: the same collection may be listed twice. */}
          {collections.map((collection, index) => (
            <CollectionCard key={index} collection={collection} t={t} locale={locale} />
          ))}
        </div>
      )}
    </>
  );
}
