import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BillingView } from "@/components/settings/billing/billing-view";
import { fetchMyBilling, fetchPublishedPlans } from "@/lib/api/store-billing";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Settings → Plan and billing (Shopify's Plan + Billing pages): the shop's Morbeh plan and status,
 * the card on file, and its bills. The published plans only feed the "Change plan" picker, so if they
 * cannot be loaded the page still shows the shop's billing (the picker then says there are none).
 */
export default async function BillingSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const [billing, plans] = await Promise.all([fetchMyBilling(), fetchPublishedPlans()]);

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {t.billingPage.back}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t.billingPage.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.billingPage.subtitle}</p>
        </header>

        {billing.outcome === "ok" ? (
          <BillingView
            billing={billing.billing}
            plans={plans.outcome === "ok" ? plans.plans : []}
            locale={locale}
            now={new Date()}
            t={t}
          />
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {billing.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            <span>
              {billing.outcome === "unauthorized"
                ? t.billingPage.unauthorized
                : t.billingPage.loadError}
            </span>
            {billing.outcome !== "unauthorized" && (
              <Link href="/settings/billing" className="text-foreground font-medium underline">
                {t.billingPage.tryAgain}
              </Link>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
