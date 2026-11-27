import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CollectionCreateForm } from "@/components/collections/collection-create-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Shopify parity Wave 1a — "Create collection": a Title and a Handle that follows it. */
export default async function NewCollectionPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="collections" user={user}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/collections">
              <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
              {t.collections.back}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.collections.newTitle}</h1>
        </div>
        <CollectionCreateForm t={t} />
      </div>
    </AppShell>
  );
}
