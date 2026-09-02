import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ReturnSummary } from "@/components/orders/order-returns-card";
import { ReturnCreateForm } from "@/components/orders/return-create-form";
import { ReturnLifecycleActions } from "@/components/orders/return-lifecycle-actions";
import { fetchOrder } from "@/lib/api/orders";
import { fetchReturnByOrder } from "@/lib/api/returns";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface OrderReturnsPageProps {
  readonly params: Promise<{ readonly orderId: string }>;
}

/**
 * The Returns detail screen (T5.3), keyed by `orderId` — the only key the backend supports
 * (`docs/plans/BLOCKERS.md`'s T5.3 ruling: no `GET /returns` list route and no
 * `GET /returns/:returnId` by-id route exist, so a `/returns` list screen or a by-id detail screen
 * would both require fabricating data or inventing a backend endpoint).
 *
 * Fetches the order first (for its header, back link, and — when no return exists yet — its real
 * line items to populate the create-return item picker via `fetchOrder`, never letting the
 * operator free-type an `orderItemRef`/`productRef`). Then fetches the return itself
 * (`fetchReturnByOrder`, the same read `OrderReturnsCard` already uses) to decide which of the
 * three states to render: the read summary + gated write actions (`ok`), the create-a-return form
 * (`not_found`), or an explicit unavailable message (`unauthorized`/`error` — never fabricated).
 */
export default async function OrderReturnsPage({ params }: OrderReturnsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { orderId } = await params;

  const orderResult = await fetchOrder(orderId);

  if (orderResult.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.orderDetail.unauthorized}
          backLabel={t.orderDetail.back}
        />
      </AppShell>
    );
  }
  if (orderResult.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.orderDetail.notFound}
          backLabel={t.orderDetail.back}
        />
      </AppShell>
    );
  }
  if (orderResult.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.orderDetail.error}
          backLabel={t.orderDetail.back}
        />
      </AppShell>
    );
  }

  const order = orderResult.order;
  const returnResult = await fetchReturnByOrder(orderId);

  return (
    <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href={`/orders/${orderId}`}>
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.returnScreen.back}
            </Link>
          </Button>
          <h1 className="text-4xl font-semibold tracking-tight">{t.returnScreen.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">#{order.orderNumber}</p>
        </div>

        {returnResult.outcome === "ok" ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t.orderDetail.returns}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReturnSummary returnRequest={returnResult.returnRequest} t={t} locale={locale} />
              </CardContent>
            </Card>
            <ReturnLifecycleActions
              orderId={orderId}
              returnId={returnResult.returnRequest.id}
              status={returnResult.returnRequest.status}
              items={returnResult.returnRequest.items}
              t={t}
            />
          </>
        ) : returnResult.outcome === "not_found" ? (
          <ReturnCreateForm orderId={orderId} items={order.items} t={t} />
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              {t.orderDetail.returnsUnavailable}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/** Same shell as `app/orders/[orderId]/page.tsx`'s own `StatePanel` — used only for the order-level fetch failing, since without the order there is nothing on this screen to show. */
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
            <Link href="/orders">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
