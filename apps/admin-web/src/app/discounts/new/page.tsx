import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DiscountEditor } from "@/components/discounts/editor/discount-editor";
import { isDiscountType, type DiscountType } from "@/lib/api/discounts";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { emptyFormValues } from "@/lib/discounts/form";
import { zoneLabel } from "@/lib/discounts/zoned-time";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface NewDiscountPageProps {
  readonly searchParams: Promise<{ readonly type?: string }>;
}

/** Phase 2 Part 2 — "Create discount" for the type chosen in the dialog (`?type=`). */
export default async function NewDiscountPage({ searchParams }: NewDiscountPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { type: requested } = await searchParams;
  const type: DiscountType = isDiscountType(requested) ? requested : "amount_off_products";
  const settings = await storeSettingsOrDefaults();

  return (
    <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/discounts">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.discounts.form.back}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.discounts.form.newTitle}</h1>
        </div>
        <DiscountEditor
          key={type}
          mode="create"
          discount={null}
          initialValues={emptyFormValues(type, new Date(), settings.timezone)}
          currency={settings.currency}
          timeZone={settings.timezone}
          zone={zoneLabel(settings.timezone, locale)}
          t={t}
          locale={locale}
        />
      </div>
    </AppShell>
  );
}
