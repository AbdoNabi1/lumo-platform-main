import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AbandonedCheckoutTimeline } from "@/components/abandoned-checkouts/abandoned-checkout-timeline";
import { RecoveryCard } from "@/components/abandoned-checkouts/recovery-card";
import { AppShell } from "@/components/app-shell";
import {
  fetchAbandonedCheckout,
  type AbandonedCheckoutDetailDto,
} from "@/lib/api/abandoned-checkouts";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { canRecoverCheckout } from "@/lib/orders/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

interface AbandonedCheckoutPageProps {
  readonly params: Promise<{ readonly checkoutId: string }>;
}

/**
 * One abandoned checkout (spec §3.7, Shopify's layout): left — items, payment totals, Recovery card,
 * timeline; right — customer contact and shipping address.
 */
export default async function AbandonedCheckoutPage({ params }: AbandonedCheckoutPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const a = t.abandonedCheckouts;
  const user = await getCurrentUser();
  const { checkoutId } = await params;
  const result = await fetchAbandonedCheckout(checkoutId);

  const shell = (children: ReactNode) => (
    <AppShell t={t} locale={locale} activeNavId="abandoned-checkouts" user={user}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Link
          href="/abandoned-checkouts"
          className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
          {a.back}
        </Link>
        {children}
      </div>
    </AppShell>
  );

  if (result.outcome === "unauthorized") {
    return shell(
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={a.unauthorized}
      />,
    );
  }
  if (result.outcome === "not_found") {
    return shell(
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={a.notFound}
      />,
    );
  }
  if (result.outcome === "error") {
    return shell(
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={a.error}
      />,
    );
  }

  const checkout = result.data;
  const canRecover = canRecoverCheckout(highestRole((await readSession())?.roles ?? []));

  return shell(
    <>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{checkout.reference}</h1>
        {checkout.recoveryStatus === "recovered" ? (
          <Badge variant="success">{a.recovered}</Badge>
        ) : (
          <Badge variant="neutral">{a.notRecovered}</Badge>
        )}
        <span className="text-muted-foreground text-sm">
          {formatDateTime(locale, checkout.createdAt)}
        </span>
      </header>
      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <ItemsCard checkout={checkout} t={t} locale={locale} />
          <TotalsCard checkout={checkout} t={t} locale={locale} />
          {checkout.recoveryStatus === "not_recovered" && (
            <RecoveryCard
              checkoutId={checkout.id}
              customerName={checkout.customerName}
              phone={checkout.phone}
              country={checkout.country}
              canRecover={canRecover}
              t={t}
            />
          )}
          <AbandonedCheckoutTimeline detail={checkout} t={t} locale={locale} />
        </div>
        <div className="flex flex-col gap-6">
          <CustomerCard checkout={checkout} t={t} />
          <ShippingCard checkout={checkout} t={t} />
        </div>
      </div>
    </>,
  );
}

interface CardProps {
  readonly checkout: AbandonedCheckoutDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}

function ItemsCard({ checkout, t, locale }: CardProps) {
  const a = t.abandonedCheckouts;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.items.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {checkout.items.map((item, index) => (
            <li
              key={`${item.productId}:${item.variantId ?? ""}:${index}`}
              className="flex items-center gap-3"
            >
              {item.imageUrl !== null ? (
                <img src={item.imageUrl} alt="" className="size-10 rounded-md object-cover" />
              ) : (
                <span aria-hidden="true" className="bg-muted size-10 rounded-md" />
              )}
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-medium">
                  {item.title ?? a.items.noTitle}
                </p>
                <p className="text-muted-foreground text-sm">
                  {[item.variantTitle, item.sku].filter((part) => part !== null).join(" · ")}
                </p>
              </div>
              <span className="text-muted-foreground text-sm tabular-nums">
                {formatCurrency(locale, item.unitPriceMinor, checkout.currency)}{" "}
                {a.items.quantity.replace("{count}", () => formatNumber(locale, item.quantity))}
              </span>
              <span className="tabular-nums">
                {formatCurrency(locale, item.lineTotalMinor, checkout.currency)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TotalsCard({ checkout, t, locale }: CardProps) {
  const a = t.abandonedCheckouts.totals;
  const money = (minor: number) => formatCurrency(locale, minor, checkout.currency);
  const totals = checkout.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {totals === null ? (
          <>
            <Row label={a.subtotal} value={money(checkout.totalMinor)} />
            <p className="text-muted-foreground">{a.notCalculated}</p>
          </>
        ) : (
          <>
            <Row label={a.subtotal} value={money(totals.subtotalMinor)} />
            {totals.discountMinor > 0 && (
              <Row label={a.discount} value={`−${money(totals.discountMinor)}`} />
            )}
            <Row label={a.shipping} value={money(totals.shippingMinor)} />
            <Row label={a.tax} value={money(totals.taxMinor)} />
            <Row label={a.total} value={money(totals.totalMinor)} strong />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${strong === true ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CustomerCard({ checkout, t }: Omit<CardProps, "locale">) {
  const a = t.abandonedCheckouts.customer;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {checkout.customerName !== null && (
          <p dir="auto" className="font-medium">
            {checkout.customerName}
          </p>
        )}
        {checkout.email !== null && (
          <a href={`mailto:${checkout.email}`} dir="ltr" className="hover:underline">
            {checkout.email}
          </a>
        )}
        {checkout.phone !== null && (
          <a href={`tel:${checkout.phone}`} dir="ltr" className="hover:underline">
            {checkout.phone}
          </a>
        )}
        {checkout.email === null && checkout.phone === null && (
          <p className="text-muted-foreground">{a.none}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ShippingCard({ checkout, t }: Omit<CardProps, "locale">) {
  const a = t.abandonedCheckouts.shippingAddress;
  const address = checkout.shippingAddress;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {address === null ? (
          <p className="text-muted-foreground">{a.none}</p>
        ) : (
          <address dir="auto" className="flex flex-col not-italic">
            {address.name !== null && <span>{address.name}</span>}
            <span>{address.line1}</span>
            {address.line2 !== null && <span>{address.line2}</span>}
            <span>
              {[address.city, address.province, address.postalCode]
                .filter((p) => p !== null && p !== "")
                .join(", ")}
            </span>
            <span>{address.country}</span>
          </address>
        )}
      </CardContent>
    </Card>
  );
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}
