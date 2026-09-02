import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import type { ReturnDetailDto } from "@/lib/api/returns";
import { fetchReturnByOrder } from "@/lib/api/returns";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ReturnStatusBadge } from "./order-status-badge";

/**
 * The read-only return summary — factored out of `OrderReturnsCard` (T5.3) so both this card
 * (Order Detail's Returns panel) and `app/orders/[orderId]/returns/page.tsx` (the write screen)
 * render the exact same fields from the exact same `GET /orders/:orderId/return` DTO, with no
 * duplicated display logic to drift.
 */
export function ReturnSummary({
  returnRequest,
  t,
  locale,
}: {
  readonly returnRequest: ReturnDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t.orderDetail.returnStatus}</dt>
        <dd>
          <ReturnStatusBadge status={returnRequest.status} t={t} />
        </dd>
      </div>
      {returnRequest.rmaNumber !== null && (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t.orderDetail.returnRma}</dt>
          <dd className="font-mono text-xs">{returnRequest.rmaNumber}</dd>
        </div>
      )}
      {returnRequest.approved !== null && (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t.orderDetail.returnApproval}</dt>
          <dd>
            <Badge variant={returnRequest.approved ? "success" : "destructive"}>
              {returnRequest.approved ? t.orderDetail.returnApproved : t.orderDetail.returnRejected}
            </Badge>
          </dd>
        </div>
      )}
      {returnRequest.refundOutcome !== null && (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t.orderDetail.returnRefund}</dt>
          <dd>
            {returnRequest.refundAmountMinor !== null && returnRequest.refundCurrency !== null
              ? formatCurrency(locale, returnRequest.refundAmountMinor, returnRequest.refundCurrency)
              : returnRequest.refundOutcome}
          </dd>
        </div>
      )}

      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium">{t.orderDetail.returnItems}</p>
        <ul className="flex flex-col gap-1">
          {returnRequest.items.map((item) => (
            <li key={item.orderItemRef} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground truncate">
                {item.productRef} × {item.quantity}
              </span>
              <span className="text-muted-foreground text-xs">{item.reasonCode}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Resolves the order's return request via `GET /orders/:orderId/return` (Phase A.30 — Returns
 * previously had no read API keyed by order reference; `ReturnRequestRepository.findByOrderRef`
 * closed that gap). An async Server Component in its own `<Suspense>` boundary so a slow/failed
 * Returns lookup never blocks the rest of the order from rendering.
 *
 * T5.3: adds the "Manage return" / "Open a return" link to the new write screen
 * (`/orders/[orderId]/returns`) in the two outcomes where the link is meaningful — `ok` (a return
 * already exists to manage) and `not_found` (none exists yet, but one can be opened there). The
 * card's own read-only rendering (now `ReturnSummary`) is otherwise unchanged.
 */
export async function OrderReturnsCard({
  orderId,
  t,
  locale,
}: {
  readonly orderId: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchReturnByOrder(orderId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.returns}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "ok" ? (
          <div className="flex flex-col gap-3">
            <ReturnSummary returnRequest={result.returnRequest} t={t} locale={locale} />
            <Button variant="outline" size="sm" asChild className="self-start">
              <Link href={`/orders/${orderId}/returns`}>{t.orderDetail.manageReturn}</Link>
            </Button>
          </div>
        ) : result.outcome === "not_found" ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">{t.orderDetail.returnsNotRequested}</p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/orders/${orderId}/returns`}>{t.orderDetail.openReturn}</Link>
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t.orderDetail.returnsUnavailable}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function OrderReturnsCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.orderDetail.returns}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
