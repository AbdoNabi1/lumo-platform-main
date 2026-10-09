"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  completeCheckout,
  initiatePayment,
  recalculate,
  requestShippingQuote,
  requestTax,
  selectPayment,
  selectShipping,
  setBillingAddress,
  setContactEmail,
  setShippingAddress,
  type CheckoutActionResult,
} from "@/app/checkout/actions";
import {
  CHECKOUT_COUNTRIES,
  DEFAULT_CHECKOUT_COUNTRY,
  isCheckoutCountry,
  isValidPhone,
  normalizePhone,
} from "@/lib/checkout-address";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type {
  CheckoutAddressInput,
  CheckoutSessionSummary,
  ShippingQuoteSummary,
} from "@/lib/runtime-api";
import type { Dictionary } from "@/messages/en";

/** `"paymentOpen"` / `"handoff"` only ever follow a PLACED order — see `openPaymentFor`. */
type ErrorReason =
  | "ownership"
  | "validation"
  | "unavailable"
  | "out-of-stock"
  | "network"
  | "paymentOpen"
  | "handoff";

/** Delay after the shopper leaves an address field before the address is saved and quoted. */
const ADDRESS_SYNC_DELAY_MS = 600;

/** Methods with no hosted page: the shopper pays offline, so the button says "Complete order". */
const OFFLINE_METHODS: ReadonlySet<string> = new Set(["cod"]);

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

/** What the shopper types for one address. Strings only; turned into API input by {@link toInput}. */
interface AddressForm {
  readonly name: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

function formFrom(
  address: CheckoutSessionSummary["shippingAddress"],
  defaultCountry: string,
): AddressForm {
  if (address === null) {
    return {
      name: "",
      phone: "",
      line1: "",
      line2: "",
      city: "",
      postalCode: "",
      // A free-text country from before the list existed matches nothing: the shopper must pick.
      country: defaultCountry,
    };
  }
  return {
    name: address.name ?? "",
    phone: address.phone ?? "",
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    postalCode: address.postalCode,
    country: isCheckoutCountry(address.country) ? address.country : "",
  };
}

/**
 * The API input for a form. The phone is normalized (Arabic digits, spaces) the way the API will;
 * a blank name or phone is left out, so an optional billing phone is never sent as an empty string.
 */
function toInput(form: AddressForm): CheckoutAddressInput {
  const name = form.name.trim();
  const phone = normalizePhone(form.phone);
  return {
    ...(name === "" ? {} : { name }),
    ...(phone === "" ? {} : { phone }),
    line1: form.line1.trim(),
    line2: form.line2.trim(),
    city: form.city.trim(),
    postalCode: form.postalCode.trim(),
    country: form.country,
  };
}

/** The shipping address is complete when everything the courier needs is there and the phone is valid. */
function isShippingComplete(form: AddressForm): boolean {
  return (
    form.line1.trim() !== "" &&
    form.city.trim() !== "" &&
    form.country !== "" &&
    form.name.trim() !== "" &&
    isValidPhone(form.phone)
  );
}

function signature(form: AddressForm): string {
  return JSON.stringify(toInput(form));
}

function errorBody(reason: ErrorReason, t: Dictionary): string {
  if (reason === "ownership") return t.checkout.ownershipErrorBody;
  if (reason === "validation") return t.checkout.validationErrorBody;
  if (reason === "unavailable") return t.checkout.unavailableErrorBody;
  if (reason === "out-of-stock") return t.checkout.outOfStock;
  if (reason === "paymentOpen") return t.checkout.paymentOpenError;
  if (reason === "handoff") return t.checkout.paymentHandoffError;
  return t.checkout.networkErrorBody;
}

/**
 * Opens the payment for a COMPLETED checkout and follows the outcome the action names. The two
 * success shapes are handled separately on purpose: "confirmation" (offline, i.e. COD) is the
 * order confirmation page, "redirect" is the hosted checkout the shopper must be sent to. A
 * failure here is never "the order failed": the order exists, so the copy says so, and the
 * retry (the placed-order panel) opens the payment without completing anything again.
 */
async function openPaymentFor(
  checkoutSessionId: string,
  handlers: {
    readonly onError: (reason: ErrorReason) => void;
    readonly onRedirect: (url: string) => void;
    readonly onConfirmation: () => void;
  },
): Promise<void> {
  const opened = await initiatePayment(checkoutSessionId);
  if (!opened.ok) {
    handlers.onError(opened.reason === "handoff" ? "handoff" : "paymentOpen");
    return;
  }
  if (opened.next === "redirect") {
    handlers.onRedirect(opened.url);
    return;
  }
  handlers.onConfirmation();
}

function ErrorBanner({
  reason,
  t,
  bannerRef,
}: {
  readonly reason: ErrorReason;
  readonly t: Dictionary;
  readonly bannerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={bannerRef}
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
    >
      {errorBody(reason, t)}
      {reason === "out-of-stock" && (
        <>
          {" "}
          <Link href="/cart" className="font-medium underline">
            {t.checkout.backToCart}
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Scrolls the error banner into view whenever a new error appears, so a failure at the bottom of a
 * long page is never missed.
 */
function useScrollToError(error: ErrorReason | null) {
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error !== null) bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);
  return bannerRef;
}

/**
 * One-page checkout (Plan 3A): contact, delivery, shipping method, payment and billing on a single
 * page with one button, next to a summary of the order — like Shopify's. `session` is a Server
 * Component prop; every mutating action calls `revalidatePath("/checkout")`, so it refreshes after
 * each call (the same mechanism `cart-view.tsx` relies on). This component never computes a
 * total of its own: the summary shows `session.totals` when the server has them, and only the
 * plain line sums (price × quantity) before that, for display.
 *
 * A placed order (`session.orderRef`) renders only the "Pay now" retry panel: nothing is ever
 * completed twice.
 */
export function CheckoutView({
  session,
  t,
  locale,
  accountEmail = null,
  paymentMethods,
}: {
  readonly session: CheckoutSessionSummary;
  readonly t: Dictionary;
  readonly locale: Locale;
  /**
   * The signed-in customer's email, resolved SERVER-side from their session (never read from a
   * cookie or typed). When present it is shown as text, applied once, and no field is offered.
   */
  readonly accountEmail?: string | null;
  /**
   * The provider keys the merchant offers (`GET /public/payment-methods`), in the order the API
   * returned them, which carries no priority beyond the first being pre-selected. `null` means the
   * list could not be loaded, `[]` that the merchant enabled nothing; both fail closed.
   */
  readonly paymentMethods: readonly string[] | null;
}) {
  if (session.orderRef !== null) {
    return <PlacedOrderPanel session={session} t={t} />;
  }
  return (
    <CheckoutForm
      session={session}
      t={t}
      locale={locale}
      accountEmail={accountEmail}
      paymentMethods={paymentMethods}
    />
  );
}

function PlacedOrderPanel({
  session,
  t,
}: {
  readonly session: CheckoutSessionSummary;
  readonly t: Dictionary;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorReason | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const bannerRef = useScrollToError(error);

  function onPayNow(): void {
    startTransition(async () => {
      await openPaymentFor(session.id, {
        onError: setError,
        onRedirect: (url) => {
          setError(null);
          setRedirecting(true);
          window.location.assign(url);
        },
        onConfirmation: () => {
          setError(null);
          router.push("/checkout/confirmation");
        },
      });
    });
  }

  return (
    <Card>
      <CardHeader>
        <h1>
          <CardTitle as="div">{t.checkout.title}</CardTitle>
        </h1>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error !== null && <ErrorBanner reason={error} t={t} bannerRef={bannerRef} />}
        {redirecting ? (
          <p className="text-muted-foreground text-sm">{t.checkout.paymentRedirecting}</p>
        ) : (
          <Button
            type="button"
            disabled={isPending}
            loading={isPending}
            className="self-start"
            onClick={onPayNow}
          >
            {t.checkout.paymentPayNow}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CheckoutForm({
  session,
  t,
  locale,
  accountEmail,
  paymentMethods,
}: {
  readonly session: CheckoutSessionSummary;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly accountEmail: string | null;
  readonly paymentMethods: readonly string[] | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorReason | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const bannerRef = useScrollToError(error);

  const [email, setEmail] = useState(session.contactEmail ?? accountEmail ?? "");
  const [shipping, setShippingState] = useState<AddressForm>(() =>
    formFrom(session.shippingAddress, DEFAULT_CHECKOUT_COUNTRY),
  );
  const [billing, setBilling] = useState<AddressForm>(() =>
    formFrom(session.billingAddress, DEFAULT_CHECKOUT_COUNTRY),
  );
  const [billingMode, setBillingMode] = useState<"same" | "different">(() =>
    session.billingAddress !== null &&
    session.shippingAddress !== null &&
    signature(formFrom(session.billingAddress, "")) !==
      signature(formFrom(session.shippingAddress, ""))
      ? "different"
      : "same",
  );
  const [quotes, setQuotes] = useState<readonly ShippingQuoteSummary[]>([]);
  const [selectedMethod, setSelectedMethodState] = useState<string | null>(
    session.selectedShippingMethod,
  );
  const [paymentChoice, setPaymentChoice] = useState<string | null>(null);
  const [phoneInvalid, setPhoneInvalid] = useState(false);

  // The address sync runs outside React's render cycle (a timer, a queue), so what it reads lives
  // in refs that the setters below keep current.
  const shippingRef = useRef(shipping);
  const selectedRef = useRef(selectedMethod);
  const contactSetRef = useRef<string | null>(session.contactEmail);
  const lastSavedRef = useRef<string | null>(
    session.shippingAddress === null ? null : signature(formFrom(session.shippingAddress, "")),
  );
  const requestedRef = useRef(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountEmailApplied = useRef(false);
  const initialQuotesRequested = useRef(false);

  function updateShipping(next: AddressForm): void {
    shippingRef.current = next;
    setShippingState(next);
  }

  function setSelectedMethod(method: string | null): void {
    selectedRef.current = method;
    setSelectedMethodState(method);
  }

  function fail(reason: ErrorReason): false {
    setError(reason);
    return false;
  }

  /** Runs `job` after every earlier job, so address saves and the final submit never overlap. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = queueRef.current.then(job, job);
    queueRef.current = next.catch(() => undefined);
    return next;
  }

  /**
   * Chooses a method from freshly quoted ones: keeps the selected one if it is still offered,
   * otherwise selects the first, then recalculates so the totals follow.
   */
  async function chooseFrom(list: readonly ShippingQuoteSummary[]): Promise<boolean> {
    const current = selectedRef.current;
    if (current !== null && list.some((quote) => quote.method === current)) return true;
    const first = list[0];
    if (first === undefined) {
      setSelectedMethod(null);
      return true;
    }
    const selected = await selectShipping(session.id, first.method);
    if (!selected.ok) return fail(selected.reason);
    setSelectedMethod(first.method);
    const recalculated = await recalculate(session.id);
    return recalculated.ok ? true : fail(recalculated.reason);
  }

  /**
   * Saves the shipping address when it is complete and differs from what was last saved, quotes
   * it, and picks a method. `seq` names the request: a result whose address was replaced by a
   * newer request is dropped.
   */
  async function syncAddress(seq: number): Promise<boolean> {
    const form = shippingRef.current;
    if (!isShippingComplete(form)) return true;
    const sig = signature(form);
    if (sig === lastSavedRef.current) return true;

    const saved = await setShippingAddress(session.id, toInput(form));
    if (!saved.ok) return seq !== requestedRef.current ? true : fail(saved.reason);
    lastSavedRef.current = sig;

    const quoted = await requestShippingQuote(session.id);
    if (seq !== requestedRef.current) return true;
    if (!quoted.ok) return fail(quoted.reason);
    setQuotes(quoted.quotes);
    return chooseFrom(quoted.quotes);
  }

  function requestSync(): Promise<boolean> {
    const seq = (requestedRef.current += 1);
    return enqueue(() => syncAddress(seq));
  }

  function scheduleSync(): void {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void requestSync();
    }, ADDRESS_SYNC_DELAY_MS);
  }

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // A reload with a complete address already saved: list its shipping methods again (the session
  // does not carry the quotes), without saving anything. The job lives in a ref so the effect
  // below depends only on whether there is such an address, and runs once.
  const hasSavedAddress =
    session.shippingAddress !== null && isShippingComplete(formFrom(session.shippingAddress, ""));
  const loadQuotesRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  useEffect(() => {
    loadQuotesRef.current = () =>
      enqueue(async () => {
        const quoted = await requestShippingQuote(session.id);
        if (!quoted.ok) return fail(quoted.reason);
        setQuotes(quoted.quotes);
        return chooseFrom(quoted.quotes);
      });
  });
  useEffect(() => {
    if (initialQuotesRequested.current || !hasSavedAddress) return;
    initialQuotesRequested.current = true;
    void loadQuotesRef.current();
  }, [hasSavedAddress]);

  // Signed-in customer: apply their account email once, so it never has to be typed.
  useEffect(() => {
    if (accountEmail === null || session.contactEmail !== null || accountEmailApplied.current) {
      return;
    }
    accountEmailApplied.current = true;
    contactSetRef.current = accountEmail;
    startTransition(async () => {
      const result = await setContactEmail(session.id, accountEmail);
      if (!result.ok) {
        contactSetRef.current = null;
        setError(result.reason);
      }
    });
  }, [accountEmail, session.contactEmail, session.id]);

  const offered = paymentMethods ?? [];
  const chosenPayment =
    paymentChoice !== null && offered.includes(paymentChoice)
      ? paymentChoice
      : (offered[0] ?? null);
  const paymentBlocked = paymentMethods === null || paymentMethods.length === 0;
  const offline = chosenPayment !== null && OFFLINE_METHODS.has(chosenPayment);
  const addressComplete = isShippingComplete(shipping);

  function onSelectShippingMethod(method: string): void {
    startTransition(async () => {
      const selected = await selectShipping(session.id, method);
      if (!selected.ok) {
        setError(selected.reason);
        return;
      }
      setError(null);
      setSelectedMethod(method);
      const recalculated = await recalculate(session.id);
      if (!recalculated.ok) setError(recalculated.reason);
    });
  }

  /** Every step of "Complete order", in order, stopping at the first failure. */
  async function placeOrder(emailValue: string): Promise<void> {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // 1. Contact.
    if (contactSetRef.current !== emailValue) {
      const contact = await setContactEmail(session.id, emailValue);
      if (!contact.ok) {
        fail(contact.reason);
        return;
      }
      contactSetRef.current = emailValue;
    }
    // 2. Shipping address, its quote and a method (all skipped when the page already did them).
    if (!(await requestSync())) return;
    if (selectedRef.current === null) {
      fail("validation");
      return;
    }
    // 3. Billing: the shipping address when "same".
    const billingForm = billingMode === "same" ? shippingRef.current : billing;
    const billed = await setBillingAddress(session.id, toInput(billingForm));
    if (!billed.ok) {
      fail(billed.reason);
      return;
    }
    // 4. Payment: no stored instrument exists yet, so the ref is the provider key itself.
    if (chosenPayment === null) return;
    const payment = await selectPayment(session.id, chosenPayment, chosenPayment);
    if (!payment.ok) {
      fail(payment.reason);
      return;
    }
    // 5-7. Tax, fresh totals, completion.
    for (const step of [requestTax, recalculate, completeCheckout] as const) {
      const result: CheckoutActionResult = await step(session.id);
      if (!result.ok) {
        fail(result.reason);
        return;
      }
    }
    // 8. Strictly after completion: the API only opens a payment for a completed checkout.
    setError(null);
    await openPaymentFor(session.id, {
      onError: (reason) => setError(reason),
      onRedirect: (url) => {
        setRedirecting(true);
        window.location.assign(url);
      },
      onConfirmation: () => router.push("/checkout/confirmation"),
    });
  }

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (isPending || paymentBlocked) return;
    const emailValue = (accountEmail ?? email).trim();
    const phoneOk = isValidPhone(shipping.phone);
    setPhoneInvalid(!phoneOk);
    if (emailValue === "" || !isShippingComplete(shipping) || !phoneOk) return;
    if (billingMode === "different") {
      const complete =
        billing.line1.trim() !== "" && billing.city.trim() !== "" && billing.country !== "";
      const billingPhoneOk = billing.phone.trim() === "" || isValidPhone(billing.phone);
      if (!complete || !billingPhoneOk) return;
    }
    startTransition(async () => {
      await placeOrder(emailValue);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.checkout.title}</h1>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <details className="border-border rounded-lg border lg:hidden">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
            <span>{t.checkout.summary.show}</span>
            <span>
              <TotalValue
                session={session}
                quotes={quotes}
                selected={selectedMethod}
                locale={locale}
              />
            </span>
          </summary>
          <div className="border-border border-t p-4">
            <SummaryBody
              session={session}
              quotes={quotes}
              selected={selectedMethod}
              t={t}
              locale={locale}
            />
          </div>
        </details>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
          {error !== null && <ErrorBanner reason={error} t={t} bannerRef={bannerRef} />}

          <Section title={t.checkout.sections.contact}>
            {accountEmail !== null ? (
              <p className="text-sm">
                {t.checkout.signedInAs} {accountEmail}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <Label htmlFor="contact-email">{t.checkout.contact.label}</Label>
                <Input
                  id="contact-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">{t.checkout.contact.hint}</p>
              </div>
            )}
          </Section>

          <Section title={t.checkout.sections.delivery}>
            <div
              onBlur={scheduleSync}
              onChange={(event) => {
                if (event.target instanceof HTMLSelectElement) scheduleSync();
              }}
            >
              <AddressFields
                idPrefix="shipping"
                value={shipping}
                onChange={(next) => {
                  updateShipping(next);
                  setPhoneInvalid(false);
                }}
                phoneRequired
                phoneInvalid={phoneInvalid}
                t={t}
              />
            </div>
          </Section>

          <Section title={t.checkout.sections.shippingMethod}>
            {!addressComplete || quotes.length === 0 ? (
              <p className="text-muted-foreground bg-muted/50 rounded-md px-3 py-3 text-sm">
                {t.checkout.shippingMethodHint}
              </p>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{t.checkout.sections.shippingMethod}</legend>
                {quotes.map((quote) => (
                  <ChoiceCard key={quote.method} checked={selectedMethod === quote.method}>
                    <input
                      type="radio"
                      name="shipping-method"
                      value={quote.method}
                      disabled={isPending}
                      checked={selectedMethod === quote.method}
                      onChange={() => onSelectShippingMethod(quote.method)}
                    />
                    <span className="flex-1">{shippingLabel(quote.method, t)}</span>
                    <span className="font-medium">
                      {formatCurrency(locale, quote.rateAmountMinor, session.currency)}
                    </span>
                  </ChoiceCard>
                ))}
              </fieldset>
            )}
          </Section>

          <Section title={t.checkout.sections.payment}>
            <p className="text-muted-foreground text-sm">{t.checkout.paymentSecure}</p>
            {paymentBlocked ? (
              <div
                role="alert"
                className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
              >
                {paymentMethods === null
                  ? t.checkout.paymentMethodsUnavailable
                  : t.checkout.paymentNoMethods}
              </div>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{t.checkout.paymentMethodsLegend}</legend>
                {offered.map((method) => (
                  <ChoiceCard key={method} checked={chosenPayment === method}>
                    <input
                      type="radio"
                      name="payment-method"
                      value={method}
                      disabled={isPending}
                      checked={chosenPayment === method}
                      onChange={() => setPaymentChoice(method)}
                    />
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span>{methodLabel(method, t)}</span>
                      {chosenPayment === method && paymentDescription(method, t) !== null && (
                        <span className="text-muted-foreground text-xs">
                          {paymentDescription(method, t)}
                        </span>
                      )}
                    </span>
                  </ChoiceCard>
                ))}
              </fieldset>
            )}
          </Section>

          <Section title={t.checkout.sections.billing}>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{t.checkout.sections.billing}</legend>
              <ChoiceCard checked={billingMode === "same"}>
                <input
                  type="radio"
                  name="billing-mode"
                  checked={billingMode === "same"}
                  onChange={() => setBillingMode("same")}
                />
                <span>{t.checkout.sameAsShipping}</span>
              </ChoiceCard>
              <ChoiceCard checked={billingMode === "different"}>
                <input
                  type="radio"
                  name="billing-mode"
                  checked={billingMode === "different"}
                  onChange={() => setBillingMode("different")}
                />
                <span>{t.checkout.differentBilling}</span>
              </ChoiceCard>
            </fieldset>
            {billingMode === "different" && (
              <AddressFields
                idPrefix="billing"
                value={billing}
                onChange={setBilling}
                phoneRequired={false}
                phoneInvalid={false}
                t={t}
              />
            )}
          </Section>

          {redirecting ? (
            <p className="text-muted-foreground text-sm">{t.checkout.paymentRedirecting}</p>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isPending || paymentBlocked}
              loading={isPending}
            >
              {isPending
                ? t.checkout.processing
                : offline
                  ? t.checkout.completeOrder
                  : t.checkout.paymentPayNow}
            </Button>
          )}
        </form>

        <aside
          aria-label={t.checkout.summary.title}
          className="border-border sticky top-6 hidden self-start rounded-lg border p-4 lg:order-last lg:block"
        >
          <SummaryBody
            session={session}
            quotes={quotes}
            selected={selectedMethod}
            t={t}
            locale={locale}
          />
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A bordered row holding a radio and its text, highlighted while chosen. */
function ChoiceCard({
  checked,
  children,
}: {
  readonly checked: boolean;
  readonly children: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm ${
        checked ? "border-foreground bg-muted/40" : "border-border"
      }`}
    >
      {children}
    </label>
  );
}

function shippingLabel(method: string, t: Dictionary): string {
  if (method === "standard" || method === "express") return t.checkout.shippingMethodLabel[method];
  return method;
}

/**
 * The shopper-facing name of a provider key. The API returns keys only (no display name), so this
 * is the one place a label is chosen; a key this build has no label for renders as-is rather than
 * being dropped or guessed at.
 */
function methodLabel(method: string, t: Dictionary): string {
  if (method === "stripe" || method === "paymob" || method === "cod") {
    return t.checkout.paymentMethod[method];
  }
  return method;
}

/** What the selected method will do; a key this build does not know says nothing. */
function paymentDescription(method: string, t: Dictionary): string | null {
  if (method === "cod") return t.checkout.paymentDescription.offline;
  if (method === "stripe" || method === "paymob") return t.checkout.paymentDescription.online;
  return null;
}

function AddressFields({
  idPrefix,
  value,
  onChange,
  phoneRequired,
  phoneInvalid,
  t,
}: {
  readonly idPrefix: string;
  readonly value: AddressForm;
  readonly onChange: (value: AddressForm) => void;
  readonly phoneRequired: boolean;
  readonly phoneInvalid: boolean;
  readonly t: Dictionary;
}) {
  function text(key: keyof AddressForm) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: event.target.value });
  }
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id("country")}>{t.checkout.address.country}</Label>
        <select
          id={id("country")}
          className={SELECT_CLASS}
          required
          autoComplete="country"
          value={value.country}
          onChange={(event) => onChange({ ...value, country: event.target.value })}
        >
          {value.country === "" && <option value="">{t.checkout.address.selectCountry}</option>}
          {CHECKOUT_COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {t.checkout.countries[code]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id("name")}>{t.checkout.address.name}</Label>
        <Input
          id={id("name")}
          required={phoneRequired}
          autoComplete="name"
          value={value.name}
          onChange={text("name")}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id("line1")}>{t.checkout.address.line1}</Label>
        <Input
          id={id("line1")}
          required
          autoComplete="address-line1"
          value={value.line1}
          onChange={text("line1")}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id("line2")}>{t.checkout.address.line2}</Label>
        <Input
          id={id("line2")}
          autoComplete="address-line2"
          value={value.line2}
          onChange={text("line2")}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={id("city")}>{t.checkout.address.city}</Label>
          <Input
            id={id("city")}
            required
            autoComplete="address-level2"
            value={value.city}
            onChange={text("city")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={id("postalCode")}>{t.checkout.address.postalCode}</Label>
          <Input
            id={id("postalCode")}
            autoComplete="postal-code"
            value={value.postalCode}
            onChange={text("postalCode")}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id("phone")}>
          {phoneRequired ? t.checkout.address.phone : t.checkout.address.phoneOptional}
        </Label>
        <Input
          id={id("phone")}
          type="tel"
          dir="ltr"
          required={phoneRequired}
          autoComplete="tel"
          aria-invalid={phoneInvalid ? "true" : undefined}
          aria-describedby={`${id("phone")}-hint`}
          value={value.phone}
          onChange={text("phone")}
        />
        <p
          id={`${id("phone")}-hint`}
          className={phoneInvalid ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
        >
          {phoneInvalid ? t.checkout.address.phoneInvalid : t.checkout.address.phoneHint}
        </p>
      </div>
    </div>
  );
}

/** Display-only sum of the lines (price × quantity); the server's totals take over once they exist. */
function linesTotal(session: CheckoutSessionSummary): number {
  return session.items.reduce((sum, item) => sum + item.unitPriceAmountMinor * item.quantity, 0);
}

/** The shipping figure to show, or null before a method is selected. */
function shippingAmount(
  session: CheckoutSessionSummary,
  quotes: readonly ShippingQuoteSummary[],
  selected: string | null,
): number | null {
  if (selected === null) return null;
  if (session.totals !== null) return session.totals.shippingMinor;
  return quotes.find((quote) => quote.method === selected)?.rateAmountMinor ?? null;
}

function totalAmount(
  session: CheckoutSessionSummary,
  quotes: readonly ShippingQuoteSummary[],
  selected: string | null,
): number {
  const subtotal = session.totals?.subtotalMinor ?? linesTotal(session);
  if (selected === null) return subtotal;
  if (session.totals !== null) return session.totals.grandTotalMinor;
  return subtotal + (shippingAmount(session, quotes, selected) ?? 0);
}

/** The total with its currency code in a muted prefix, like Shopify. */
function TotalValue({
  session,
  quotes,
  selected,
  locale,
}: {
  readonly session: CheckoutSessionSummary;
  readonly quotes: readonly ShippingQuoteSummary[];
  readonly selected: string | null;
  readonly locale: Locale;
}) {
  return (
    <>
      <span className="text-muted-foreground me-1.5 text-xs font-normal">{session.currency}</span>
      {formatCurrency(locale, totalAmount(session, quotes, selected), session.currency)}
    </>
  );
}

function SummaryBody({
  session,
  quotes,
  selected,
  t,
  locale,
}: {
  readonly session: CheckoutSessionSummary;
  readonly quotes: readonly ShippingQuoteSummary[];
  readonly selected: string | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const shippingMinor = shippingAmount(session, quotes, selected);
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {session.items.map((item, index) => (
          <li key={`${item.productId}-${item.variantId ?? index}`} className="flex gap-3 text-sm">
            <span
              aria-label={`${t.checkout.summary.quantity} ${item.quantity}`}
              className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
            >
              {item.quantity}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{item.title ?? item.productId}</span>
              {item.variantTitle != null && (
                <span className="text-muted-foreground text-xs">{item.variantTitle}</span>
              )}
            </span>
            <span className="tabular-nums">
              {formatCurrency(locale, item.unitPriceAmountMinor * item.quantity, session.currency)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="border-border flex flex-col gap-1.5 border-t pt-3 text-sm">
        <SummaryRow
          label={t.checkout.summary.subtotal}
          value={formatCurrency(
            locale,
            session.totals?.subtotalMinor ?? linesTotal(session),
            session.currency,
          )}
        />
        <SummaryRow
          label={t.checkout.summary.shipping}
          value={
            shippingMinor === null
              ? t.checkout.summary.enterShippingAddress
              : formatCurrency(locale, shippingMinor, session.currency)
          }
          muted={shippingMinor === null}
        />
        {session.totals !== null && (
          <SummaryRow
            label={t.checkout.summary.taxes}
            value={formatCurrency(locale, session.totals.taxMinor, session.currency)}
          />
        )}
        <div className="border-border mt-1 flex items-baseline justify-between border-t pt-3">
          <dt className="text-base font-semibold">{t.checkout.summary.total}</dt>
          <dd className="text-xl font-semibold">
            <TotalValue session={session} quotes={quotes} selected={selected} locale={locale} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={muted ? "text-muted-foreground text-xs" : "tabular-nums"}>{value}</dd>
    </div>
  );
}
