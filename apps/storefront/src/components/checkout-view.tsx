"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@platform/ui";
import {
  completeCheckout,
  recalculate,
  requestShippingQuote,
  requestTax,
  selectPayment,
  selectShipping,
  setBillingAddress,
  setContactEmail,
  setShippingAddress,
  type CheckoutActionResult,
  type ShippingQuoteActionResult,
} from "@/app/checkout/actions";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type {
  CheckoutAddressInput,
  CheckoutSessionSummary,
  ShippingQuoteSummary,
} from "@/lib/runtime-api";
import type { Dictionary } from "@/messages/en";

type Step =
  "contact" | "shipping-address" | "shipping-method" | "billing-address" | "payment" | "review";

type ErrorReason = "ownership" | "validation" | "unavailable" | "network";

const EMPTY_ADDRESS: CheckoutAddressInput = {
  line1: "",
  line2: "",
  city: "",
  postalCode: "",
  country: "",
};

/** Only Stripe is configured on the backend today (see the deployment note in `docs/plans/PHASE-2-public-checkout.md`) — a single, real option, not a fabricated multi-provider picker. */
const PAYMENT_METHOD = { paymentMethodRef: "card", provider: "stripe" } as const;

function addressFromDto(address: CheckoutSessionSummary["shippingAddress"]): CheckoutAddressInput {
  return address ?? EMPTY_ADDRESS;
}

function errorBody(reason: ErrorReason, t: Dictionary): string {
  if (reason === "ownership") return t.checkout.ownershipErrorBody;
  if (reason === "validation") return t.checkout.validationErrorBody;
  if (reason === "unavailable") return t.checkout.unavailableErrorBody;
  return t.checkout.networkErrorBody;
}

/**
 * Derives the active step from server-known facts only, plus the two bits of purely-local UI
 * state the session DTO cannot carry (Phase 2's `PublicCheckoutSessionDto` has no shipping-quote
 * list and no payment-selection field — see `public-checkout-routes.ts`'s DTO comment). A page
 * reload before `payment`/`review` is reached re-derives from the session and re-asks for
 * whichever of those two steps it cannot recover — never silently skips ahead, never loses data
 * that IS server-known.
 */
function currentStep(
  session: CheckoutSessionSummary,
  hasQuotes: boolean,
  paymentSelected: boolean,
): Step {
  // WP-1 (G-52): the contact email comes first — completing a guest checkout needs it, and asking
  // last would put a validation failure at the worst possible moment.
  if (session.contactEmail === null) return "contact";
  if (session.selectedShippingMethod !== null) {
    if (session.billingAddress !== null) {
      return paymentSelected ? "review" : "payment";
    }
    return "billing-address";
  }
  return hasQuotes ? "shipping-method" : "shipping-address";
}

/**
 * Renders the guest checkout stepper: contact email → shipping address → shipping method → billing
 * address → payment → review. One Client Component for the whole flow (every step is interactive) — same
 * split as `cart-view.tsx`. `session` is a Server Component prop; every mutating action calls
 * `revalidatePath("/checkout")`, so `session` refreshes automatically after each successful step
 * (the same mechanism `cart-view.tsx` already relies on) — this component never recomputes a total
 * itself, it only ever renders `session.totals`.
 */
export function CheckoutView({
  session,
  t,
  locale,
  accountEmail = null,
}: {
  readonly session: CheckoutSessionSummary;
  readonly t: Dictionary;
  readonly locale: Locale;
  /**
   * The signed-in customer's email, resolved SERVER-side from their session (never read from a
   * cookie or typed). When present the contact step applies it once automatically — no re-entry —
   * and only falls back to a pre-filled field if that call fails.
   */
  readonly accountEmail?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorReason | null>(null);

  const [quotes, setQuotes] = useState<readonly ShippingQuoteSummary[]>([]);
  const [paymentSelected, setPaymentSelected] = useState(false);
  const [recalculated, setRecalculated] = useState(false);

  const [contactForm, setContactForm] = useState(session.contactEmail ?? accountEmail ?? "");
  const accountEmailApplied = useRef(false);

  const [shippingForm, setShippingForm] = useState<CheckoutAddressInput>(
    addressFromDto(session.shippingAddress),
  );
  const [billingForm, setBillingForm] = useState<CheckoutAddressInput>(
    addressFromDto(session.billingAddress),
  );
  const [sameAsShipping, setSameAsShipping] = useState(true);

  const step = currentStep(session, quotes.length > 0, paymentSelected);

  // Signed-in customer: apply their account email once, so they never re-type it. A ref (not state)
  // guards against a double run; a failure just leaves the pre-filled contact field to submit.
  useEffect(() => {
    if (step !== "contact" || accountEmail === null || accountEmailApplied.current) return;
    accountEmailApplied.current = true;
    startTransition(async () => {
      const result = await setContactEmail(session.id, accountEmail);
      if (!result.ok) setError(result.reason);
    });
  }, [step, accountEmail, session.id]);

  // Fetch totals once the review step is reached (Task 5: "Review → recalculate, show totals").
  useEffect(() => {
    if (step !== "review" || recalculated || isPending) return;
    setRecalculated(true);
    startTransition(async () => {
      const result = await recalculate(session.id);
      if (!result.ok) setError(result.reason);
    });
  }, [step, recalculated, isPending, session.id]);

  /** Applies a `CheckoutActionResult` to the error state; returns whether it succeeded, so a caller can chain a follow-up call only on success. */
  function applyResult(result: CheckoutActionResult): boolean {
    if (!result.ok) {
      setError(result.reason);
      return false;
    }
    setError(null);
    return true;
  }

  function onContactSubmit(event: React.FormEvent): void {
    event.preventDefault();
    startTransition(async () => {
      applyResult(await setContactEmail(session.id, contactForm));
    });
  }

  function onShippingAddressSubmit(event: React.FormEvent): void {
    event.preventDefault();
    startTransition(async () => {
      if (!applyResult(await setShippingAddress(session.id, shippingForm))) return;
      const quoted: ShippingQuoteActionResult = await requestShippingQuote(session.id);
      if (!quoted.ok) {
        setError(quoted.reason);
        return;
      }
      setError(null);
      setQuotes(quoted.quotes);
    });
  }

  function onSelectShippingMethod(method: string): void {
    startTransition(async () => {
      applyResult(await selectShipping(session.id, method));
    });
  }

  function onBillingAddressSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const address = sameAsShipping ? shippingForm : billingForm;
    startTransition(async () => {
      applyResult(await setBillingAddress(session.id, address));
    });
  }

  function onSelectPayment(): void {
    startTransition(async () => {
      const result = await selectPayment(
        session.id,
        PAYMENT_METHOD.paymentMethodRef,
        PAYMENT_METHOD.provider,
      );
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setError(null);
      setPaymentSelected(true);
    });
  }

  function onPlaceOrder(): void {
    startTransition(async () => {
      // Tax is requested once more right before completion so the totals shown are as fresh as
      // possible; `recalculate` below folds it into `session.totals`.
      const taxed = await requestTax(session.id);
      if (!taxed.ok) {
        setError(taxed.reason);
        return;
      }
      const recalculatedResult = await recalculate(session.id);
      if (!recalculatedResult.ok) {
        setError(recalculatedResult.reason);
        return;
      }
      const completed = await completeCheckout(session.id);
      if (!completed.ok) {
        setError(completed.reason);
        return;
      }
      setError(null);
      router.push("/checkout/confirmation");
    });
  }

  return (
    <Card>
      <CardHeader>
        <h1>
          <CardTitle as="div">{t.checkout.title}</CardTitle>
        </h1>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              "contact",
              "shipping-address",
              "shipping-method",
              "billing-address",
              "payment",
              "review",
            ] as const
          ).map((candidate) => (
            <Badge key={candidate} variant={candidate === step ? "accent" : "neutral"}>
              {t.checkout.step[toStepKey(candidate)]}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error !== null && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {errorBody(error, t)}
          </div>
        )}

        {step === "contact" && (
          <form onSubmit={onContactSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="contact-email">{t.checkout.contact.label}</Label>
              <Input
                id="contact-email"
                type="email"
                autoComplete="email"
                required
                value={contactForm}
                onChange={(event) => setContactForm(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t.checkout.contact.hint}</p>
            </div>
            <Button type="submit" disabled={isPending} loading={isPending} className="self-start">
              {isPending ? t.checkout.address.saving : t.checkout.address.continue}
            </Button>
          </form>
        )}

        {step === "shipping-address" && (
          <form onSubmit={onShippingAddressSubmit} className="flex flex-col gap-3">
            <AddressFields value={shippingForm} onChange={setShippingForm} t={t} />
            <Button type="submit" disabled={isPending} loading={isPending} className="self-start">
              {isPending ? t.checkout.address.saving : t.checkout.address.continue}
            </Button>
          </form>
        )}

        {step === "shipping-method" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t.checkout.step.shippingMethod}</legend>
            {quotes.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t.checkout.shippingMethodLoading}</p>
            ) : (
              quotes.map((quote) => (
                <label
                  key={quote.method}
                  className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="shipping-method"
                      value={quote.method}
                      disabled={isPending}
                      checked={session.selectedShippingMethod === quote.method}
                      onChange={() => onSelectShippingMethod(quote.method)}
                    />
                    {quote.method}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(locale, quote.rateAmountMinor, session.currency)}
                  </span>
                </label>
              ))
            )}
          </fieldset>
        )}

        {step === "billing-address" && (
          <form onSubmit={onBillingAddressSubmit} className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameAsShipping}
                onChange={(event) => setSameAsShipping(event.target.checked)}
              />
              {t.checkout.sameAsShipping}
            </label>
            {!sameAsShipping && (
              <AddressFields value={billingForm} onChange={setBillingForm} t={t} />
            )}
            <Button type="submit" disabled={isPending} loading={isPending} className="self-start">
              {isPending ? t.checkout.address.saving : t.checkout.address.continue}
            </Button>
          </form>
        )}

        {step === "payment" && (
          <div className="flex flex-col gap-3">
            <label className="border-border flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="payment-method" checked readOnly />
              {t.checkout.paymentCardOption}
            </label>
            <Button
              type="button"
              disabled={isPending}
              loading={isPending}
              className="self-start"
              onClick={onSelectPayment}
            >
              {isPending ? t.checkout.paymentSelecting : t.checkout.paymentContinue}
            </Button>
          </div>
        )}

        {step === "review" && (
          <div className="flex flex-col gap-3">
            {session.totals === null ? (
              <p className="text-muted-foreground text-sm">{t.checkout.review.calculating}</p>
            ) : (
              <dl className="flex flex-col gap-1 text-sm">
                <ReviewRow
                  label={t.checkout.review.subtotal}
                  value={formatCurrency(locale, session.totals.subtotalMinor, session.currency)}
                />
                <ReviewRow
                  label={t.checkout.review.shipping}
                  value={formatCurrency(locale, session.totals.shippingMinor, session.currency)}
                />
                <ReviewRow
                  label={t.checkout.review.tax}
                  value={formatCurrency(locale, session.totals.taxMinor, session.currency)}
                />
                <ReviewRow
                  label={t.checkout.review.total}
                  value={formatCurrency(locale, session.totals.grandTotalMinor, session.currency)}
                  emphasize
                />
              </dl>
            )}
            <Button
              type="button"
              disabled={isPending || session.totals === null}
              loading={isPending}
              className="self-start"
              onClick={onPlaceOrder}
            >
              {isPending ? t.checkout.review.placingOrder : t.checkout.review.placeOrder}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function toStepKey(
  step: Step,
): "contact" | "shippingAddress" | "shippingMethod" | "billingAddress" | "payment" | "review" {
  if (step === "shipping-address") return "shippingAddress";
  if (step === "shipping-method") return "shippingMethod";
  if (step === "billing-address") return "billingAddress";
  return step;
}

function ReviewRow({
  label,
  value,
  emphasize = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={emphasize ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={emphasize ? "text-base font-semibold" : undefined}>{value}</dd>
    </div>
  );
}

function AddressFields({
  value,
  onChange,
  t,
}: {
  readonly value: CheckoutAddressInput;
  readonly onChange: (value: CheckoutAddressInput) => void;
  readonly t: Dictionary;
}) {
  function field(key: keyof CheckoutAddressInput) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: event.target.value });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="line1">{t.checkout.address.line1}</Label>
        <Input id="line1" required value={value.line1} onChange={field("line1")} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="line2">{t.checkout.address.line2}</Label>
        <Input id="line2" value={value.line2 ?? ""} onChange={field("line2")} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="city">{t.checkout.address.city}</Label>
        <Input id="city" required value={value.city} onChange={field("city")} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="postalCode">{t.checkout.address.postalCode}</Label>
        <Input id="postalCode" required value={value.postalCode} onChange={field("postalCode")} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="country">{t.checkout.address.country}</Label>
        <Input id="country" required value={value.country} onChange={field("country")} />
      </div>
    </div>
  );
}
