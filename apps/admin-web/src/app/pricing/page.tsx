import { cookies } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import {
  ActivatePriceListForm,
  ChangePriceForm,
  CreatePriceForm,
  CreatePriceListForm,
  CreatePricingRuleForm,
  CreateTaxClassForm,
  PublishPriceForm,
} from "@/components/pricing/pricing-operations-forms";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.6 — the Pricing operations console. No `GET` route exists anywhere in this domain — no list,
 * no get-by-id, for prices, price lists, pricing rules, or tax classes
 * (`docs/plans/BLOCKERS.md`'s T5.6 entry), so, same as `app/inventory/page.tsx`'s T5.5 console,
 * this renders as independent sections of self-contained forms, not a data table. Every
 * `priceListId`/`productId`/`priceId`/`taxClassRef` field is a plain text input for the same
 * reason, and the four "create" forms surface the created record's id after a successful submit —
 * the only way an operator will ever see it.
 */
export default async function PricingPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="pricing" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">{t.pricingPage.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.pricingPage.subtitle}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.pricingPage.priceListsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <CreatePriceListForm t={t} />
            <ActivatePriceListForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.pricingPage.pricesTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <CreatePriceForm t={t} />
            <ChangePriceForm t={t} />
            <PublishPriceForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.pricingPage.taxClassesTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateTaxClassForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.pricingPage.pricingRulesTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <CreatePricingRuleForm t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
