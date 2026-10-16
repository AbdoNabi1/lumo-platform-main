import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DiscountStatusBadge } from "@/components/discounts/discount-status-badge";
import { DiscountEditor } from "@/components/discounts/editor/discount-editor";
import { fetchDiscount } from "@/lib/api/discounts";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formValuesFromDto } from "@/lib/discounts/form";
import { resolveTargetLabels } from "@/lib/discounts/target-labels";
import { zoneLabel } from "@/lib/discounts/zoned-time";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface DiscountPageProps {
  readonly params: Promise<{ readonly discountId: string }>;
}

/** Phase 2 Part 2 — one discount (`GET /discounts/:id`) in Shopify's form, with Performance. */
export default async function DiscountPage({ params }: DiscountPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { discountId } = await params;

  const result = await fetchDiscount(discountId);
  if (result.outcome !== "ok") {
    const [icon, message] =
      result.outcome === "unauthorized"
        ? [
            <LockIcon key="i" aria-hidden="true" className="size-5" />,
            t.discounts.form.unauthorized,
          ]
        : result.outcome === "not_found"
          ? [
              <SearchXIcon key="i" aria-hidden="true" className="size-5" />,
              t.discounts.form.notFound,
            ]
          : [
              <AlertTriangleIcon key="i" aria-hidden="true" className="size-5" />,
              t.discounts.form.loadError,
            ];
    return (
      <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
        <StatePanel icon={icon} message={message} backLabel={t.discounts.form.back} />
      </AppShell>
    );
  }

  const discount = result.discount;
  const [settings, labels] = await Promise.all([
    storeSettingsOrDefaults(),
    resolveTargetLabels(discount, locale),
  ]);

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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {discount.code ?? discount.title}
            </h1>
            <DiscountStatusBadge status={discount.status} t={t} />
          </div>
        </div>
        <DiscountEditor
          key={JSON.stringify(discount)}
          mode="edit"
          discount={discount}
          initialValues={formValuesFromDto(discount, labels, settings.currency, settings.timezone)}
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

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/discounts">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
