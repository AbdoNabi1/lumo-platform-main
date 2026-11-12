"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import { draftShippingRatesAction } from "@/app/draft-orders/actions";
import type { DraftOrderDto, DraftShippingRateDto } from "@/lib/api/draft-orders";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { MAX_DRAFT_AMOUNT_MINOR, type DraftFormShipping } from "@/lib/orders/draft-orders";
import { fromMinorUnits, toMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";

/** Shopify's "Shipping and delivery" dialog: the shop's rates for the saved draft, custom, or free. */
export function DraftShippingDialog({
  current,
  currency,
  saveFirst,
  onApply,
  onClose,
  t,
  locale,
}: {
  readonly current: DraftFormShipping;
  readonly currency: string;
  readonly saveFirst: () => Promise<DraftOrderDto | null>;
  readonly onApply: (shipping: DraftFormShipping) => void;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const s = t.draftOrders.editor.shippingDialog;
  const [kind, setKind] = useState<"rate" | "custom" | "free">(current?.kind ?? "rate");
  const [rates, setRates] = useState<readonly DraftShippingRateDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [method, setMethod] = useState(current?.kind === "rate" ? current.method : "");
  const [title, setTitle] = useState(current?.kind === "custom" ? current.title : "");
  const [price, setPrice] = useState(
    current?.kind === "custom" ? fromMinorUnits(current.amountMinor, currency) : "",
  );
  // Ruling 15: rates are for the SAVED draft's address — save first, then ask. Once per opening.
  const saveFirstRef = useRef(saveFirst);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let draft: DraftOrderDto | null = null;
      try {
        draft = await saveFirstRef.current();
      } catch {
        draft = null;
      }
      if (cancelled) return;
      if (draft === null || draft.shippingAddress === null || draft.lines.length === 0) {
        setMessage(s.needsAddress);
        setRates([]);
        return;
      }
      const result = await draftShippingRatesAction(draft.id).catch(() => null);
      if (cancelled) return;
      if (result === null || !result.ok) {
        setMessage(result?.message ?? s.noRates);
        setRates([]);
        return;
      }
      setRates(result.rates);
      if (result.rates.length === 0) setMessage(s.noRates);
    })();
    return () => {
      cancelled = true;
    };
  }, [s.needsAddress, s.noRates]);

  const amount = toMinorUnits(price, currency);
  const chosenRate = rates?.find((r) => r.method === method);
  const valid =
    kind === "free" ||
    (kind === "rate" && chosenRate !== undefined) ||
    (kind === "custom" &&
      title.trim() !== "" &&
      amount !== null &&
      amount >= 0 &&
      amount <= MAX_DRAFT_AMOUNT_MINOR);
  const apply = () => {
    if (kind === "free") onApply({ kind: "free" });
    else if (kind === "rate" && chosenRate !== undefined)
      onApply({
        kind: "rate",
        method: chosenRate.method,
        title: chosenRate.title,
        amountMinor: chosenRate.amountMinor,
      });
    else if (kind === "custom" && amount !== null)
      onApply({ kind: "custom", title: title.trim(), amountMinor: amount });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{s.title}</DialogTitle>
        </DialogHeader>
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{s.title}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="shipping-kind"
              checked={kind === "rate"}
              onChange={() => setKind("rate")}
            />
            {s.rates}
          </label>
          {kind === "rate" && (
            <div className="flex flex-col gap-2 ps-6">
              {rates === null && <p className="text-muted-foreground">{s.loading}</p>}
              {message !== null && <p className="text-muted-foreground">{message}</p>}
              {rates?.map((rate) => (
                <label key={rate.method} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="shipping-rate"
                    checked={method === rate.method}
                    onChange={() => setMethod(rate.method)}
                  />
                  <span dir="auto">{rate.title}</span>
                  <span className="text-muted-foreground ms-auto tabular-nums">
                    {formatCurrency(locale, rate.amountMinor, currency)}
                  </span>
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="shipping-kind"
              checked={kind === "custom"}
              onChange={() => setKind("custom")}
            />
            {s.custom}
          </label>
          {kind === "custom" && (
            <div className="grid gap-2 ps-6 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="shipping-title">{s.name}</Label>
                <Input
                  id="shipping-title"
                  dir="auto"
                  maxLength={100}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="shipping-price">{s.price}</Label>
                <Input
                  id="shipping-price"
                  inputMode="decimal"
                  dir="ltr"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </div>
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="shipping-kind"
              checked={kind === "free"}
              onChange={() => setKind("free")}
            />
            {s.free}
          </label>
        </fieldset>
        <DialogFooter>
          {current !== null && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onApply(null);
                onClose();
              }}
            >
              {s.remove}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {s.cancel}
          </Button>
          <Button type="button" disabled={!valid} onClick={apply}>
            {s.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
