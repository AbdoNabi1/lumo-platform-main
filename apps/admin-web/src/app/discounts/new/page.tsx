import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CouponCreateForm } from "@/components/discounts/coupon-create-form";
import { CouponRedeemForm } from "@/components/discounts/coupon-redeem-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * The Coupons create + redeem screen (T5.8 Part A) — gated to `operator`+ by `middleware.ts`.
 * Redeem is a customer-facing/POS-style action rather than a typical admin write (see the task
 * brief), so it's a second, smaller panel on this same page instead of a full screen of its own —
 * still one of the 4 coupon routes this task covers.
 */
export default async function NewCouponPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/discounts">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.couponCreate.back}
            </Link>
          </Button>
          <h1 className="text-4xl font-semibold tracking-tight">{t.couponCreate.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.couponCreate.subtitle}</p>
        </div>

        <Card>
          <CardContent>
            <CouponCreateForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.couponRedeem.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <CouponRedeemForm t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
