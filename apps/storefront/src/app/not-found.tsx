import { CompassIcon } from "lucide-react";
import { StatePanel } from "@/components/state-panel";
import { StoreChrome } from "@/components/store-chrome";
import { dictionaryFor } from "@/lib/i18n";
import { getRequestLocale, getRequestShell } from "@/lib/request-locale";

/** Ruling 23: unmatched URLs render here (outside any group), inside the same store chrome. */
export default async function NotFound() {
  const [shell, locale] = await Promise.all([getRequestShell(), getRequestLocale()]);
  const t = dictionaryFor(locale);
  return (
    <StoreChrome shell={shell} locale={locale} previewToken={null}>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <StatePanel
          icon={<CompassIcon className="size-6" />}
          title={t.notFound.title}
          body={t.notFound.body}
          action={{ href: "/", label: t.notFound.backHome }}
        />
      </main>
    </StoreChrome>
  );
}
