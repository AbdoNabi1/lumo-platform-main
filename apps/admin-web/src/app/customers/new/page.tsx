import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CustomerForm } from "@/components/customers/customer-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Shopify parity Wave 1b — "New customer". Operators and up reach it (middleware); the API enforces `customers:register`. */
export default async function NewCustomerPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="customers" user={user}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/customers">
              <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
              {t.customerForm.back}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.customerForm.newTitle}</h1>
        </div>
        <CustomerForm t={t} />
      </div>
    </AppShell>
  );
}
