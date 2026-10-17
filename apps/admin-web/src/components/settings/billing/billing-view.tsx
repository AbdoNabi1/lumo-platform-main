"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { changeMyPlanAction, payMyInvoiceAction } from "@/app/settings/billing/actions";
import type { FormState } from "@/lib/api/mutation";
import {
  billingBanner,
  trialDaysLeft,
  type MerchantBillingDto,
  type MerchantInvoiceDto,
  type MerchantPlanDto,
} from "@/lib/billing/model";
import { formatCurrency, formatMediumDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

type BillingCopy = Dictionary["billingPage"];

/** "EGP 299.00 / month" — the plan's price in its own currency and billing cycle. */
function priceLabel(plan: MerchantPlanDto, locale: Locale, copy: BillingCopy): string {
  const price = formatCurrency(locale, plan.priceMinor, plan.currency);
  return (plan.billingCycle === "annual" ? copy.perYear : copy.perMonth).replace("{price}", price);
}

/** The plan card's status line, and whether it should read as an emergency. */
function statusLine(
  billing: MerchantBillingDto,
  locale: Locale,
  now: Date,
  copy: BillingCopy,
): { readonly text: string; readonly destructive: boolean } {
  if (billing.plan === null || billing.status === null) {
    return { text: copy.statusNone, destructive: false };
  }
  if (billingBanner(billing, now) === "past-due") {
    return { text: copy.statusPastDue, destructive: true };
  }
  if (billing.status === "trial") {
    const days = trialDaysLeft(billing.trialEndsAt, now);
    if (days === null || billing.trialEndsAt === null) {
      return { text: copy.statusActiveNoDate, destructive: false };
    }
    if (days === 0) return { text: copy.statusTrialEnded, destructive: false };
    const date = formatMediumDate(locale, billing.trialEndsAt);
    const template = days === 1 ? copy.statusTrialOneDay : copy.statusTrial;
    return {
      text: template.replace("{days}", formatNumber(locale, days)).replace("{date}", date),
      destructive: false,
    };
  }
  if (billing.status === "cancelled") return { text: copy.statusCancelled, destructive: false };
  if (billing.nextChargeAt === null) return { text: copy.statusActiveNoDate, destructive: false };
  return {
    text: copy.statusActive.replace("{date}", formatMediumDate(locale, billing.nextChargeAt)),
    destructive: false,
  };
}

/** The plan picker: the published plans as radios, the current one marked and pre-selected. */
function ChangePlanForm({
  plans,
  currentKey,
  locale,
  t,
  onClose,
}: {
  readonly plans: readonly MerchantPlanDto[];
  readonly currentKey: string | null;
  readonly locale: Locale;
  readonly t: Dictionary;
  readonly onClose: () => void;
}) {
  const copy = t.billingPage;
  const [state, formAction, isPending] = useActionState(changeMyPlanAction, INITIAL_STATE);
  const [selected, setSelected] = useState<string | null>(currentKey);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.choosePlan}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {plans.length === 0 ? (
            <p className="text-muted-foreground text-sm">{copy.noPlans}</p>
          ) : (
            <div role="radiogroup" aria-label={copy.choosePlan} className="flex flex-col gap-2">
              {plans.map((plan) => (
                <label
                  key={plan.key}
                  className="border-border has-[:checked]:border-primary flex cursor-pointer items-center gap-3 rounded-md border p-3"
                >
                  <input
                    type="radio"
                    name="planKey"
                    value={plan.key}
                    checked={selected === plan.key}
                    onChange={() => setSelected(plan.key)}
                    disabled={isPending}
                  />
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-medium">{plan.name}</span>
                    <span className="text-muted-foreground text-sm">
                      {priceLabel(plan, locale, copy)}
                    </span>
                  </span>
                  {plan.key === currentKey && <Badge variant="info">{copy.currentPlan}</Badge>}
                </label>
              ))}
            </div>
          )}
          {state.status === "error" && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              loading={isPending}
              disabled={isPending || selected === null || selected === currentKey}
            >
              {isPending ? copy.changing : copy.confirmChange}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function invoiceBadge(
  status: string,
  copy: BillingCopy,
): { readonly label: string; readonly variant: "neutral" | "success" | "warning" | "destructive" } {
  switch (status) {
    case "issued":
      return { label: copy.invoiceIssued, variant: "warning" };
    case "paid":
      return { label: copy.invoicePaid, variant: "success" };
    case "failed":
      return { label: copy.invoiceFailed, variant: "destructive" };
    case "draft":
      return { label: copy.invoiceDraft, variant: "neutral" };
    case "voided":
      return { label: copy.invoiceVoided, variant: "neutral" };
    default:
      return { label: status, variant: "neutral" };
  }
}

/**
 * Pay now for one issued invoice. The runtime's pay route is not idempotent (every call opens a new
 * checkout), so the button is disabled for as long as the submit is in flight — and stays that way
 * while the browser is being redirected to the checkout page.
 */
function PayNowButton({
  invoiceId,
  copy,
}: {
  readonly invoiceId: string;
  readonly copy: BillingCopy;
}) {
  const [state, formAction, isPending] = useActionState(payMyInvoiceAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Button type="submit" variant="outline" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? copy.paying : copy.payNow}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive max-w-60 text-end text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

function InvoiceRow({
  invoice,
  locale,
  copy,
}: {
  readonly invoice: MerchantInvoiceDto;
  readonly locale: Locale;
  readonly copy: BillingCopy;
}) {
  const badge = invoiceBadge(invoice.status, copy);
  return (
    <TableRow>
      <TableCell>{formatMediumDate(locale, invoice.createdAt)}</TableCell>
      <TableCell className="tabular-nums">
        {formatCurrency(locale, invoice.totalMinor, invoice.currency)}
      </TableCell>
      <TableCell>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </TableCell>
      <TableCell>
        {invoice.status === "issued" && <PayNowButton invoiceId={invoice.id} copy={copy} />}
      </TableCell>
    </TableRow>
  );
}

/**
 * Settings → Plan and billing (Shopify's Plan + Billing): the plan and its status, the payment
 * method, and the bills with Pay now for an issued one. Reads/writes only through the page's server
 * actions. `now` is passed in so the days-left count is the server's, not the browser's, clock.
 */
export function BillingView({
  billing,
  plans,
  locale,
  now,
  t,
}: {
  readonly billing: MerchantBillingDto;
  readonly plans: readonly MerchantPlanDto[];
  readonly locale: Locale;
  readonly now: Date;
  readonly t: Dictionary;
}) {
  const copy = t.billingPage;
  const [choosing, setChoosing] = useState(false);
  const status = statusLine(billing, locale, now, copy);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{copy.planCardTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {billing.plan !== null && (
              <>
                <span className="text-base font-semibold">{billing.plan.name}</span>
                <span className="text-muted-foreground text-sm">
                  {priceLabel(billing.plan, locale, copy)}
                </span>
              </>
            )}
            <p className={status.destructive ? "text-destructive text-sm font-medium" : "text-sm"}>
              {status.text}
            </p>
          </div>
          {!choosing && (
            <Button type="button" variant="outline" onClick={() => setChoosing(true)}>
              {copy.changePlan}
            </Button>
          )}
        </CardContent>
      </Card>

      {choosing && (
        <ChangePlanForm
          plans={plans}
          currentKey={billing.plan?.key ?? null}
          locale={locale}
          t={t}
          onClose={() => setChoosing(false)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{copy.paymentCardTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {billing.cardOnFile ? copy.cardSaved : copy.noCard}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.billsTitle}</CardTitle>
        </CardHeader>
        {billing.invoices.length === 0 ? (
          <CardContent className="text-muted-foreground text-sm">{copy.billsEmpty}</CardContent>
        ) : (
          <CardContent className="p-0">
            <Table aria-label={copy.billsTitle}>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columnDate}</TableHead>
                  <TableHead>{copy.columnTotal}</TableHead>
                  <TableHead>{copy.columnStatus}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.invoices.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} locale={locale} copy={copy} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
