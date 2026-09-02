import { cookies } from "next/headers";
import { CompassIcon } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export default async function NotFound() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />
      <StatePanel
        icon={<CompassIcon className="size-6" />}
        title={t.notFound.title}
        body={t.notFound.body}
        action={{ href: "/", label: t.notFound.backHome }}
      />
    </main>
  );
}
