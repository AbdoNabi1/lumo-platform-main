"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@platform/ui";
import { draftShippingRatesAction } from "@/app/draft-orders/actions";
import type {
  DraftOrderDto,
  DraftPayment,
  DraftRequirement,
  DraftShippingRateDto,
} from "@/lib/api/draft-orders";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { DraftForm, DraftFormShipping } from "@/lib/orders/draft-orders";
import { fromMinorUnits, toMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";

/** The merchant-entered amount bound (`MAX_DRAFT_AMOUNT_MINOR`). */
const MAX_AMOUNT_MINOR = 10_000_000;

/** What the editor is busy with, for the right "…ing" words. */
export type DraftActivity = "save" | "invoice" | "complete" | null;

const ALL_REQUIREMENTS: readonly DraftRequirement[] = [
  "lines",
  "shipping_address",
  "shipping",
  "email",
];

/** Arabic-Indic and Persian digits to ASCII, for a percentage typed on an Arabic keyboard. */
const asciiDigits = (text: string) =>
  text.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });

/**
 * Shopify's Payment card: totals from the LAST SAVE (Ruling 14), the discount and shipping dialogs,
 * what the draft still needs, and the two actions. Collect payment hands only the choice to the
 * editor, which saves first and then confirms the saved total (Pre-flight 11). Mark as paid is
 * admin-only: others see it disabled, with the reason (Ruling 25; the API decides).
 */
export function DraftPaymentCard(props: {
  readonly draft: DraftOrderDto | null;
  readonly form: DraftForm;
  readonly dirty: boolean;
  readonly editable: boolean;
  readonly canMarkPaid: boolean;
  readonly pending: boolean;
  readonly activity: DraftActivity;
  readonly onDiscount: (discount: DraftForm["discount"]) => void;
  readonly onShipping: (shipping: DraftFormShipping) => void;
  /** Saves pending changes first (Ruling 15); null when the save failed. */
  readonly saveFirst: () => Promise<DraftOrderDto | null>;
  readonly onSendInvoice: () => void;
  readonly onCollect: (payment: DraftPayment) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const { draft, form, dirty, editable, canMarkPaid, pending, activity, errors, t, locale } = props;
  const p = t.draftOrders.editor.payment;
  const currency = draft?.currency ?? "EGP";
  const money = (minor: number) => formatCurrency(locale, minor, currency);
  const totals = draft?.totals ?? null;
  const [discountOpen, setDiscountOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const missing =
    draft === null
      ? ALL_REQUIREMENTS
      : ALL_REQUIREMENTS.filter(
          (r) => draft.missing.invoice.includes(r) || draft.missing.complete.includes(r),
        );

  const taxText = (): string => {
    if (totals === null) return "—";
    const tax = totals.taxMinor;
    if (tax === null) return draft?.shippingAddress == null ? p.taxPending : p.taxUnavailable;
    return totals.taxIncluded ? p.taxIncluded.replace("{tax}", () => money(tax)) : money(tax);
  };
  const shippingError = Object.entries(errors).find(([key]) => key.startsWith("shipping."))?.[1];
  const discountError = Object.entries(errors).find(([key]) => key.startsWith("discount"))?.[1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{p.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className={dirty ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
          <Row label={p.subtotal} value={totals === null ? "—" : money(totals.subtotalMinor)} />
          <Row
            label={
              editable ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  disabled={pending}
                  onClick={() => setDiscountOpen(true)}
                >
                  {form.discount === null ? p.addDiscount : p.discount}
                </Button>
              ) : (
                p.discount
              )
            }
            detail={form.discount?.reason || undefined}
            value={
              totals === null || totals.discountMinor === 0
                ? "—"
                : `−${money(totals.discountMinor)}`
            }
          />
          {discountError !== undefined && (
            <p role="alert" className="text-destructive text-xs">
              {discountError}
            </p>
          )}
          <Row
            label={
              editable ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  disabled={pending}
                  onClick={() => setShippingOpen(true)}
                >
                  {form.shipping === null ? p.addShipping : p.shipping}
                </Button>
              ) : (
                p.shipping
              )
            }
            detail={
              form.shipping === null || form.shipping.kind === "free"
                ? undefined
                : form.shipping.title
            }
            value={
              totals === null || draft?.shipping == null
                ? "—"
                : totals.shippingMinor === 0
                  ? p.free
                  : money(totals.shippingMinor)
            }
          />
          {shippingError !== undefined && (
            <p role="alert" className="text-destructive text-xs">
              {shippingError}
            </p>
          )}
          <Row label={p.tax} value={taxText()} />
          <Row
            label={<strong>{p.total}</strong>}
            value={<strong>{totals === null ? "—" : money(totals.totalMinor)}</strong>}
          />
        </dl>
        {dirty && <p className="text-muted-foreground text-xs">{p.saveToUpdate}</p>}
        {editable && (
          <>
            {missing.length > 0 && (
              <ul className="text-muted-foreground list-disc ps-5 text-xs">
                {missing.map((m) => (
                  <li key={m}>{t.draftOrders.editor.missing[m]}</li>
                ))}
              </ul>
            )}
            {activity === "complete" && (
              <p role="status" className="text-muted-foreground text-xs">
                {p.working}
              </p>
            )}
            {activity === "invoice" && (
              <p role="status" className="text-muted-foreground text-xs">
                {t.draftOrders.editor.invoice.sending}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={props.onSendInvoice}
                disabled={pending}
              >
                {p.sendInvoice}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" disabled={pending}>
                    {p.collectPayment}
                    <ChevronDownIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuItem
                          disabled={!canMarkPaid}
                          onSelect={() => props.onCollect("paid")}
                        >
                          {p.markAsPaid}
                        </DropdownMenuItem>
                      </TooltipTrigger>
                      {!canMarkPaid && <TooltipContent>{p.markAsPaidAdminOnly}</TooltipContent>}
                    </Tooltip>
                  </TooltipProvider>
                  {!canMarkPaid && (
                    <p className="text-muted-foreground px-2 pb-1 text-xs">
                      {p.markAsPaidAdminOnly}
                    </p>
                  )}
                  <DropdownMenuItem onSelect={() => props.onCollect("collect_on_delivery")}>
                    {p.collectOnDelivery}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </CardContent>
      {discountOpen && (
        <DiscountDialog
          current={form.discount}
          currency={currency}
          onApply={props.onDiscount}
          onClose={() => setDiscountOpen(false)}
          t={t}
        />
      )}
      {shippingOpen && (
        <ShippingDialog
          current={form.shipping}
          currency={currency}
          saveFirst={props.saveFirst}
          onApply={props.onShipping}
          onClose={() => setShippingOpen(false)}
          t={t}
          locale={locale}
        />
      )}
    </Card>
  );
}

function Row({
  label,
  detail,
  value,
}: {
  readonly label: ReactNode;
  readonly detail?: string | undefined;
  readonly value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground flex min-w-0 items-center gap-2">
        {label}
        {detail !== undefined && (
          <span dir="auto" className="truncate text-xs">
            {detail}
          </span>
        )}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function DiscountDialog({
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
    (valueType === "fixed" ? value <= MAX_AMOUNT_MINOR : value <= 100);
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

function ShippingDialog({
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
      amount <= MAX_AMOUNT_MINOR);
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
