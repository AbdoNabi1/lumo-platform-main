"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Button } from "@platform/ui";
import { bulkShipWithCarrierAction } from "@/app/orders/carrier-actions";
import { carrierLabel } from "@/lib/shipping/carrier-label";
import type { Dictionary } from "@/messages/en";
import { BulkShipResultsDialog, type BulkShipFailure } from "./bulk-ship-results-dialog";

/** Spec §8.7 and the API: 1–50 orders per ship / print. */
const MAX_SELECTED = 50;

interface SelectionValue {
  /** Selected order ids, in the order they were picked. */
  readonly ids: readonly string[];
  readonly notice: "tooMany" | null;
  /**
   * After an all-success bulk ship the selection is empty; the bar is held mounted (so focus has a
   * target) until the merchant clears it.
   */
  readonly held: boolean;
  readonly hold: () => void;
  readonly toggle: (orderId: string, checked: boolean) => void;
  /** Replaces the selection (select all on this page); anything past the cap is refused with the notice. */
  readonly setAll: (orderIds: readonly string[]) => void;
  readonly remove: (orderIds: readonly string[]) => void;
  /** Empties the selection and releases the held bar. */
  readonly clear: () => void;
}

const SelectionContext = createContext<SelectionValue | null>(null);

/** The selection when a provider is above, otherwise `null` (the table then supplies its own). */
export function useOptionalOrdersSelection(): SelectionValue | null {
  return useContext(SelectionContext);
}

export function useOrdersSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (value === null)
    throw new Error("Selection components must sit inside OrdersSelectionProvider");
  return value;
}

export function OrdersSelectionProvider({ children }: { readonly children: ReactNode }) {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<"tooMany" | null>(null);
  const [held, setHeld] = useState(false);

  const toggle = useCallback(
    (orderId: string, checked: boolean) => {
      if (!checked) {
        setIds((current) => current.filter((id) => id !== orderId));
        setNotice(null);
        return;
      }
      if (ids.includes(orderId)) return;
      if (ids.length >= MAX_SELECTED) {
        setNotice("tooMany");
        return;
      }
      setNotice(null);
      setIds([...ids, orderId]);
    },
    [ids],
  );
  const setAll = useCallback((orderIds: readonly string[]) => {
    setIds(orderIds.slice(0, MAX_SELECTED));
    setNotice(orderIds.length > MAX_SELECTED ? "tooMany" : null);
  }, []);
  const hold = useCallback(() => setHeld(true), []);
  const remove = useCallback((orderIds: readonly string[]) => {
    setIds((current) => current.filter((id) => !orderIds.includes(id)));
  }, []);
  const clear = useCallback(() => {
    setIds([]);
    setNotice(null);
    setHeld(false);
  }, []);

  const value = useMemo(
    () => ({ ids, notice, held, hold, toggle, setAll, remove, clear }),
    [ids, notice, held, hold, toggle, setAll, remove, clear],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** The row's checkbox. The cell sits above the stretched row link (`relative z-10`). */
export function OrderSelectCheckbox({
  orderId,
  orderNumber,
  t,
  label,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly t: Dictionary;
  /** The accessible name; defaults to the carrier-shipping wording. */
  readonly label?: string;
}) {
  const { ids, toggle } = useOrdersSelection();
  return (
    <span className="relative z-10 inline-flex">
      <input
        type="checkbox"
        className="accent-primary size-4"
        aria-label={label ?? t.carrierShipping.selectOrder.replace("{n}", orderNumber)}
        checked={ids.includes(orderId)}
        onChange={(event) => toggle(orderId, event.currentTarget.checked)}
      />
    </span>
  );
}

interface Results {
  readonly shipped: number;
  readonly failed: readonly BulkShipFailure[];
  readonly shippedIds: readonly string[];
}

/**
 * Ship / print / clear for the selection, plus the results dialog. It lives inside the unified bulk bar
 * (the orders table's bar and the standalone `OrdersBulkBar` below). Every state the dialog needs sits
 * here, and the surrounding bar is held mounted (`hold`) until focus has been restored.
 */
export function CarrierBulkActions({
  carriers,
  t,
}: {
  readonly carriers: readonly { readonly key: string; readonly displayName: string }[];
  readonly t: Dictionary;
}) {
  const { ids, notice, remove, clear, hold } = useOrdersSelection();
  const copy = t.carrierShipping;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const clearRef = useRef<HTMLButtonElement>(null);
  const shipRef = useRef<HTMLButtonElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);
  const carrier = carriers[0];

  function ship(): void {
    if (carrier === undefined) return;
    const selected = [...ids];
    setError(null);
    start(async () => {
      const result = await bulkShipWithCarrierAction(selected, carrier.key);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      const failedIds = new Set(result.failed.map((failure) => failure.orderId));
      setResults({
        shipped: result.shipped,
        failed: result.failed,
        shippedIds: selected.filter((id) => !failedIds.has(id)),
      });
      hold();
      setOpen(true);
    });
  }

  function print(): void {
    window.open(`/orders/awb?orderIds=${ids.join(",")}`, "_blank", "noopener,noreferrer");
  }

  function closed(next: boolean): void {
    setOpen(next);
    if (!next && results !== null) remove(results.shippedIds);
  }

  return (
    <>
      {carrier !== undefined && (
        <Button
          ref={shipRef}
          type="button"
          size="sm"
          onClick={ship}
          disabled={pending || ids.length === 0}
          loading={pending}
        >
          {copy.shipWith.replace("{carrier}", carrierLabel(carrier.key, carrier.displayName, t))}
        </Button>
      )}
      <Button
        ref={printRef}
        type="button"
        size="sm"
        variant="outline"
        onClick={print}
        disabled={ids.length === 0}
      >
        {copy.printWaybills}
      </Button>
      <Button ref={clearRef} type="button" size="sm" variant="ghost" onClick={clear}>
        {copy.clearSelection}
      </Button>
      {notice === "tooMany" && (
        <p role="alert" className="text-destructive text-sm">
          {copy.tooMany}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <BulkShipResultsDialog
        open={open}
        onOpenChange={closed}
        shipped={results?.shipped ?? 0}
        failed={results?.failed ?? []}
        t={t}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = ids.length > 0 ? (shipRef.current ?? printRef.current) : null;
          (target ?? clearRef.current)?.focus();
        }}
      />
    </>
  );
}

/**
 * The carrier-only sticky bar (count + {@link CarrierBulkActions}): the Bosta half of the bulk bar on its
 * own. The orders list renders the unified bar inside the table header instead (order operations'
 * actions and these, one selection), so this is for a surface that has only the carrier actions.
 */
export function OrdersBulkBar({
  carriers,
  t,
}: {
  readonly carriers: readonly { readonly key: string; readonly displayName: string }[];
  readonly t: Dictionary;
}) {
  const { ids, held } = useOrdersSelection();
  const copy = t.carrierShipping;
  if (ids.length === 0 && !held) return null;
  return (
    <div
      role="toolbar"
      aria-label={copy.selected.replace("{count}", String(ids.length))}
      className="bg-card border-border sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2 shadow-sm"
    >
      <span className="text-sm font-medium">
        {copy.selected.replace("{count}", String(ids.length))}
      </span>
      <CarrierBulkActions carriers={carriers} t={t} />
    </div>
  );
}
