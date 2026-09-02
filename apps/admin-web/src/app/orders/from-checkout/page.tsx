import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { OrderFromCheckoutForm } from "@/components/orders/order-from-checkout-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * The "create order from checkout session" recovery screen (T5.2) — gated to `operator`+ by
 * `middleware.ts`. There is no checkout-session admin screen in this codebase to launch this from
 * contextually, so it's its own small screen, linked from the Orders list.
 */
export default async function OrderFromCheckoutPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/orders">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.orderDetail.back}
            </Link>
          </Button>
          <h1 className="text-4xl font-semibold tracking-tight">{t.orderFromCheckout.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.orderFromCheckout.subtitle}</p>
        </div>

        <Card>
          <CardContent>
            <OrderFromCheckoutForm t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
