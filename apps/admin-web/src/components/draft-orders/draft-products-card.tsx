"use client";

import { useEffect, useId, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { ProductThumb } from "@/components/products/product-thumb";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { DraftFormLine } from "@/lib/orders/draft-orders";
import type { Dictionary } from "@/messages/en";
import { DraftProductPicker } from "./draft-product-picker";

/** The API's per-line cap (`MAX_DRAFT_LINE_QUANTITY`). */
const MAX_QUANTITY = 9999;

const sameLine = (a: DraftFormLine, b: DraftFormLine) =>
  a.productId === b.productId && a.variantId === b.variantId;

/**
 * Shopify's Products card (spec §4.9): a search field and Browse, both opening the picker (the field
 * hands over what was typed), and one row per line with its quantity. Adding a variant that is
 * already a line raises its quantity — the server merges too (Ruling 20). Prices are display only.
 */
export function DraftProductsCard({
  lines,
  onChange,
  errors,
  editable,
  currency,
  t,
  locale,
}: {
  readonly lines: readonly DraftFormLine[];
  readonly onChange: (lines: readonly DraftFormLine[]) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly editable: boolean;
  readonly currency: string | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const e = t.draftOrders.editor.products;
  const id = useId();
  const [picker, setPicker] = useState<{ readonly query: string } | null>(null);

  const add = (line: DraftFormLine) => {
    const existing = lines.find((l) => sameLine(l, line));
    onChange(
      existing === undefined
        ? [...lines, line]
        : lines.map((l) =>
            sameLine(l, line) ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + 1) } : l,
          ),
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{e.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editable && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Label htmlFor={`${id}-search`} className="sr-only">
                {e.search}
              </Label>
              <SearchIcon
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id={`${id}-search`}
                type="search"
                dir="auto"
                value=""
                placeholder={e.search}
                className="ps-9"
                onChange={(event) => setPicker({ query: event.target.value })}
              />
            </div>
            <Button type="button" variant="outline" onClick={() => setPicker({ query: "" })}>
              {e.browse}
            </Button>
          </div>
        )}
        {errors["lines"] !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {errors["lines"]}
          </p>
        )}
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{e.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((line, index) => {
              const error =
                errors[`lines.${index}`] ??
                errors[`lines.${index}.quantity`] ??
                errors[`lines.${index}.variantId`];
              return (
                <li
                  key={`${line.productId}:${line.variantId ?? ""}`}
                  className="flex flex-col gap-1"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <ProductThumb url={line.imageUrl} alt="" className="size-12" />
                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="truncate font-medium">
                        {line.title}
                      </p>
                      <p dir="auto" className="text-muted-foreground text-sm">
                        {[line.variantTitle, line.sku].filter((part) => part !== null).join(" · ")}
                      </p>
                      <p className="text-muted-foreground text-sm tabular-nums">
                        {line.unitPriceMinor !== null && currency !== null
                          ? e.each.replace("{price}", () =>
                              formatCurrency(locale, line.unitPriceMinor ?? 0, currency),
                            )
                          : e.pricedOnSave}
                      </p>
                    </div>
                    <QuantityInput
                      label={e.quantity.replace("{title}", () => line.title)}
                      value={line.quantity}
                      readOnly={!editable}
                      onChange={(quantity) =>
                        onChange(lines.map((l, i) => (i === index ? { ...l, quantity } : l)))
                      }
                    />
                    {editable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={e.remove.replace("{title}", () => line.title)}
                        onClick={() => onChange(lines.filter((_, i) => i !== index))}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {error !== undefined && (
                    <p role="alert" className="text-destructive text-sm">
                      {error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {picker !== null && (
        <DraftProductPicker
          initialQuery={picker.query}
          onAdd={add}
          onClose={() => setPicker(null)}
          t={t}
          locale={locale}
        />
      )}
    </Card>
  );
}

/** A quantity the merchant can clear and retype: only whole numbers 1–9999 reach the form. */
function QuantityInput({
  label,
  value,
  readOnly,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly readOnly: boolean;
  readonly onChange: (quantity: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Input
      type="number"
      inputMode="numeric"
      dir="ltr"
      min={1}
      max={MAX_QUANTITY}
      aria-label={label}
      readOnly={readOnly}
      value={text}
      className="w-24"
      onChange={(event) => {
        setText(event.target.value);
        const quantity = Number(event.target.value);
        if (Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY) {
          onChange(quantity);
        }
      }}
      onBlur={() => setText(String(value))}
    />
  );
}
