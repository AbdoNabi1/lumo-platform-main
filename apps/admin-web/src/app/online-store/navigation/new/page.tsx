import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { MenuEditor } from "@/components/online-store/menu-editor";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** A new menu: its handle and title, then items. Operators and up (`ROUTE_ROLE_REQUIREMENTS`). */
export default async function NewMenuPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  return (
    <AppShell t={t} locale={locale} activeNavId="online-store-navigation" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/online-store/navigation">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.onlineStoreNavigation.back}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.onlineStoreNavigation.newMenu}
          </h1>
        </div>
        <MenuEditor t={t} locale={locale} menu={null} canEdit />
      </div>
    </AppShell>
  );
}
