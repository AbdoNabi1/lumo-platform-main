"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@platform/ui";
import type { DraftOrderDto, DraftPayment, DraftRequirement } from "@/lib/api/draft-orders";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { DraftForm, DraftFormShipping } from "@/lib/orders/draft-orders";
import type { Dictionary } from "@/messages/en";
import { DraftDiscountDialog } from "./draft-discount-dialog";
import { DraftShippingDialog } from "./draft-shipping-dialog";

/** What the editor is busy with, for the right "…ing" words. */
export type DraftActivity = "save" | "invoice" | "complete" | null;

const ALL_REQUIREMENTS: readonly DraftRequirement[] = [
  "lines",
  "shipping_address",
  "shipping",
  "email",
];

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
        <DraftDiscountDialog
          current={form.discount}
          currency={currency}
          onApply={props.onDiscount}
          onClose={() => setDiscountOpen(false)}
          t={t}
        />
      )}
      {shippingOpen && (
        <DraftShippingDialog
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
