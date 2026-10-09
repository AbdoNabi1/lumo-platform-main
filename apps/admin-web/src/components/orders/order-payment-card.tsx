import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import { fetchPaymentIntent } from "@/lib/api/payments";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { CodCollectionForm } from "./cod-collection-form";
import { PaymentStatusBadge } from "./order-status-badge";

/** A payment in one of these states can never be collected, whatever its amounts say. */
const CLOSED_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  "captured",
  "refunded",
  "partially_refunded",
  "closed",
  "cancelled",
  "expired",
  "failed",
]);

/** The method's name for a person: the Settings → Payments label for a known key, the key itself otherwise. */
function methodLabel(provider: string, t: Dictionary): string {
  if (provider === "cod") return t.orderDetail.paymentMethodCod;
  if (provider === "stripe") return t.paymentSettings.methodStripe;
  if (provider === "paymob") return t.paymentSettings.methodPaymob;
  return provider;
}

/**
 * Resolves `paymentRef` against Payments' `GetPaymentIntent` (`paymentRef` IS the `PaymentIntent`
 * id — see `apps/runtime`'s `hasCapturedPayment` query, which keys on exactly that). An async
 * Server Component in its own `<Suspense>` boundary so a slow/failed Payments lookup never blocks
 * the rest of the order.
 *
 * Plan 3A: names the method, and for a cash-on-delivery payment that is not yet collected offers
 * "Mark cash as received" — the only action that marks such a payment paid.
 */
export async function OrderPaymentCard({
  orderId,
  paymentRef,
  t,
  locale,
}: {
  readonly orderId: string;
  readonly paymentRef: string | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (paymentRef === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.orderDetail.payment}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t.orderDetail.noPaymentRequested}</p>
        </CardContent>
      </Card>
    );
  }

  const result = await fetchPaymentIntent(paymentRef);
  const collectable =
    result.outcome === "ok" &&
    result.paymentIntent.provider === "cod" &&
    result.paymentIntent.capturedAmountMinor < result.paymentIntent.amountMinor &&
    !CLOSED_PAYMENT_STATUSES.has(result.paymentIntent.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.payment}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "ok" ? (
          <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-2 text-sm">
              <Row label={t.orderDetail.paymentMethod}>
                <span>{methodLabel(result.paymentIntent.provider, t)}</span>
              </Row>
              <Row label={t.orderDetail.paymentStatusLabel}>
                <PaymentStatusBadge status={result.paymentIntent.status} t={t} />
              </Row>
              <Row label={t.orderDetail.paymentAmount}>
                <span className="tabular-nums">
                  {formatCurrency(
                    locale,
                    result.paymentIntent.amountMinor,
                    result.paymentIntent.currency,
                  )}
                </span>
              </Row>
              {result.paymentIntent.capturedAmountMinor > 0 && (
                <Row label={t.orderDetail.paymentCaptured}>
                  <span className="tabular-nums">
                    {formatCurrency(
                      locale,
                      result.paymentIntent.capturedAmountMinor,
                      result.paymentIntent.currency,
                    )}
                  </span>
                </Row>
              )}
              {result.paymentIntent.refundedAmountMinor > 0 && (
                <Row label={t.orderDetail.paymentRefunded}>
                  <span className="tabular-nums">
                    {formatCurrency(
                      locale,
                      result.paymentIntent.refundedAmountMinor,
                      result.paymentIntent.currency,
                    )}
                  </span>
                </Row>
              )}
              {result.paymentIntent.pspReference !== null && (
                <Row label={t.orderDetail.paymentReference}>
                  <span className="font-mono text-xs">{result.paymentIntent.pspReference}</span>
                </Row>
              )}
              {result.paymentIntent.capturedAt !== null && (
                <p className="text-muted-foreground text-xs">
                  {t.orderDetail.paymentCapturedOn.replace(
                    "{date}",
                    formatDateTime(locale, result.paymentIntent.capturedAt),
                  )}
                </p>
              )}
              {result.paymentIntent.refundedAt !== null && (
                <p className="text-muted-foreground text-xs">
                  {t.orderDetail.paymentRefundedOn.replace(
                    "{date}",
                    formatDateTime(locale, result.paymentIntent.refundedAt),
                  )}
                </p>
              )}
            </dl>
            {collectable && (
              <CodCollectionForm
                orderId={orderId}
                paymentIntentId={result.paymentIntent.id}
                confirmMessage={t.orderDetail.confirmCashReceived.replace(
                  "{amount}",
                  formatCurrency(
                    locale,
                    result.paymentIntent.amountMinor,
                    result.paymentIntent.currency,
                  ),
                )}
                t={t}
              />
            )}
          </div>
        ) : (
          <div>
            <p className="text-muted-foreground text-sm">{t.orderDetail.paymentUnavailable}</p>
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">{t.orderDetail.paymentReference}: </span>
              <span className="font-mono">{paymentRef}</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function OrderPaymentCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.orderDetail.payment}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
