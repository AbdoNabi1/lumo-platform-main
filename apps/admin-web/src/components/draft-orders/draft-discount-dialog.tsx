"use client";

import { useState } from "react";
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
import { MAX_DRAFT_AMOUNT_MINOR, type DraftForm } from "@/lib/orders/draft-orders";
import { fromMinorUnits, toMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";

/** Arabic-Indic and Persian digits to ASCII, for a percentage typed on an Arabic keyboard. */
const asciiDigits = (text: string) =>
  text.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });

/** Shopify's "Add discount" dialog: an amount or a percentage, and an optional reason (Ruling 13). */
export function DraftDiscountDialog({
  current,
  currency,
  onApply,
  onClose,
  t,
}: {
  readonly current: DraftForm["discount"];
  readonly currency: string;
  readonly onApply: (discount: DraftForm["discount"]) => void;
  readonly onClose: () => void;
  readonly t: Dictionary;
}) {
  const d = t.draftOrders.editor.discountDialog;
  const [valueType, setValueType] = useState<"fixed" | "percentage">(current?.valueType ?? "fixed");
  const [text, setText] = useState(
    current === null
      ? ""
      : current.valueType === "fixed"
        ? fromMinorUnits(current.value, currency)
        : String(current.value),
  );
  const [reason, setReason] = useState(current?.reason ?? "");
  const percent = asciiDigits(text.trim());
  const value =
    valueType === "fixed"
      ? toMinorUnits(text, currency)
      : /^\d{1,3}$/.test(percent)
        ? Number(percent)
        : null;
  const valid =
    value !== null &&
    value >= 0 &&
    (valueType === "fixed" ? value <= MAX_DRAFT_AMOUNT_MINOR : value <= 100);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
        </DialogHeader>
        <fieldset className="flex gap-4">
          <legend className="sr-only">{d.type}</legend>
          {(["fixed", "percentage"] as const).map((type) => (
            <label key={type} className="flex items-center gap-2">
              <input
                type="radio"
                name="discount-type"
                checked={valueType === type}
                onChange={() => setValueType(type)}
              />
              {d[type]}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="discount-value">{d.value}</Label>
          <Input
            id="discount-value"
            inputMode="decimal"
            dir="ltr"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="discount-reason">{d.reason}</Label>
          <Input
            id="discount-reason"
            dir="auto"
            maxLength={255}
            value={reason}
            placeholder={d.defaultReason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
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
              {d.remove}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {d.cancel}
          </Button>
          <Button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (value !== null) onApply({ valueType, value, reason });
              onClose();
            }}
          >
            {d.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
