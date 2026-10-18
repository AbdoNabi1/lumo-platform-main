"use client";

import { useTransition, type ReactNode } from "react";
import { MoreHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { runBulkOrderAction, type BulkActionState } from "@/app/orders/actions";
import type { BulkOrderAction, OrderListItemDto } from "@/lib/api/orders";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** The result of one bulk action, with the numbers of the orders it ran on (to name them in the details). */
export interface BulkOutcome {
  readonly state: BulkActionState;
  readonly orderNumbers: ReadonlyMap<string, string>;
}

function MenuButton({
  children,
  disabled,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * Shopify's bulk-action bar (spec §1.5): it replaces the table header while rows are selected. Every
 * action is the `runBulkOrderAction` server action (one API call, a result per order); Print packing
 * slips opens the print page in a new tab. The ⋯ menu is a native `<details>`, like the order page's.
 */
export function OrdersBulkBar({
  selected,
  t,
  locale,
  canMarkCashReceived,
  onFinished,
  onExportSelected,
}: {
  readonly selected: readonly OrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly canMarkCashReceived: boolean;
  readonly onFinished: (outcome: BulkOutcome) => void;
  readonly onExportSelected?: (() => void) | undefined;
}) {
  const [isPending, startTransition] = useTransition();
  const b = t.ordersPage.bulk;
  const orderIds = selected.map((order) => order.id);
  const orderNumbers = new Map(selected.map((order) => [order.id, order.orderNumber]));

  const run = (action: BulkOrderAction) =>
    startTransition(async () => {
      let state: BulkActionState;
      try {
        state = await runBulkOrderAction(action, orderIds);
      } catch {
        // A thrown action (network) must end as the error state, not as a "Working…" that never clears.
        state = { status: "error", message: t.formErrors.unexpected };
      }
      onFinished({ state, orderNumbers });
    });
  const printSlips = () => {
    window.open(
      `/orders/packing-slips?ids=${orderIds.map(encodeURIComponent).join(",")}`,
      "_blank",
      "noopener",
    );
  };

  return (
    <div
      role="toolbar"
      aria-label={b.toolbarLabel}
      className="flex flex-wrap items-center gap-2 py-1"
    >
      <span className="text-foreground me-2 text-sm font-semibold">
        {b.selectedCount.replace("{count}", formatNumber(locale, selected.length))}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => run("fulfill")}
      >
        {b.fulfillItems}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => run("capture_payments")}
      >
        {b.capturePayments}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={printSlips}>
        {b.printPackingSlips}
      </Button>
      <details className="relative">
        <summary
          aria-label={b.moreActions}
          title={b.moreActions}
          className="border-input bg-card hover:border-foreground/40 focus-visible:ring-ring inline-flex h-8 cursor-pointer list-none items-center rounded-lg border px-2 focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden"
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-4" />
        </summary>
        <div className="border-border bg-card absolute end-0 z-20 mt-2 flex min-w-56 flex-col gap-1 rounded-xl border p-2 shadow-lg">
          <MenuButton disabled={isPending} onClick={() => run("archive")}>
            {b.archive}
          </MenuButton>
          <MenuButton disabled={isPending} onClick={() => run("unarchive")}>
            {b.unarchive}
          </MenuButton>
          {onExportSelected !== undefined && (
            <MenuButton disabled={isPending} onClick={onExportSelected}>
              {b.exportSelected}
            </MenuButton>
          )}
          {canMarkCashReceived && (
            <MenuButton disabled={isPending} onClick={() => run("mark_cod_collected")}>
              {b.markCashReceived}
            </MenuButton>
          )}
        </div>
      </details>
      {isPending && <span className="text-muted-foreground text-sm">{b.working}</span>}
    </div>
  );
}

/** "N orders updated · M skipped" (+ failed), with a details list naming each skipped/failed order and why. */
export function BulkResultNote({
  outcome,
  t,
  locale,
  onDismiss,
}: {
  readonly outcome: BulkOutcome;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly onDismiss: () => void;
}) {
  const b = t.ordersPage.bulk;
  const { state } = outcome;
  if (state.status === "idle") return null;
  const dismiss = (
    <Button type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label={b.dismiss}>
      <XIcon aria-hidden="true" />
    </Button>
  );
  if (state.status === "error") {
    return (
      <div className="border-border flex items-start gap-3 border-b px-4 py-3 sm:px-5">
        <p role="alert" className="text-destructive min-w-0 flex-1 text-sm">
          {state.message}
        </p>
        {dismiss}
      </div>
    );
  }
  const count = (outcomeKind: "ok" | "skipped" | "failed") =>
    state.results.filter((result) => result.outcome === outcomeKind).length;
  const failed = count("failed");
  const summary =
    b.summary
      .replace("{updated}", formatNumber(locale, count("ok")))
      .replace("{skipped}", formatNumber(locale, count("skipped"))) +
    (failed > 0 ? b.failedSuffix.replace("{failed}", formatNumber(locale, failed)) : "");
  const problems = state.results.filter((result) => result.outcome !== "ok");
  /** An unknown or missing reason reads as the generic text — never a raw token or an empty "#1002 — ". */
  const reasonLabel = (reason: string | undefined) =>
    (reason === undefined
      ? undefined
      : (b.reasons as Record<string, string | undefined>)[reason]) ?? b.reasons.unexpected_error;

  return (
    <div className="border-border bg-muted/40 flex items-start gap-3 border-b px-4 py-3 text-sm sm:px-5">
      <div role="status" className="min-w-0 flex-1">
        <p className="font-medium">{summary}</p>
        {problems.length > 0 && (
          <details className="mt-1">
            <summary className="text-muted-foreground cursor-pointer">{b.details}</summary>
            <ul className="mt-1 list-disc ps-5">
              {problems.map((problem) => (
                <li key={problem.orderId}>
                  {`#${outcome.orderNumbers.get(problem.orderId) ?? problem.orderId} — ${reasonLabel(problem.reason)}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {dismiss}
    </div>
  );
}
