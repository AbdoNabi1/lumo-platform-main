import type { PaymentProvider } from "@platform/contracts";
import type { ProviderRegistration } from "../application/provider-registry";
import { CashOnDeliveryProvider } from "./cash-on-delivery-provider";
import { InMemoryPaymentProvider } from "./in-memory-port-adapters";
import { ManualPaymentProvider } from "./manual-payment-provider";

/**
 * The three providers that ship with this service, expressed as ordinary registrations — the same
 * shape a provider registered from outside would have. Nothing else in payments knows any name;
 * the domain reasons about the capabilities declared here.
 */

/**
 * Cash on delivery (WP-13 T13.4): no PSP, so nothing settles it at a provider — it settles when
 * the cash is handed over (`settlesAtPayTime`) and there is no one to call us back
 * (`!deliversWebhooks`), so only an operator's confirmed collection can mark it paid. Never
 * off-session: nobody is charged online. Stateless, so one instance is safely shared.
 */
export function cashOnDeliveryRegistration(): ProviderRegistration {
  const provider = new CashOnDeliveryProvider();
  return {
    key: "cod",
    capabilities: {
      settlesAtPayTime: true,
      deliversWebhooks: false,
      requiresMerchantCredentials: false,
      chargesOffSession: false,
    },
    backing: "real",
    create: () => provider,
  };
}

/**
 * Order operations Part 4 — `manual` ("Manual payment"): a draft order the merchant marks as paid. COD's
 * capabilities (settled by an operator's confirmation, no webhooks) plus `recordedByStaff` — never
 * offered, never enabled, and never cash a courier collects (Rulings 8 and 9).
 */
export function manualPaymentRegistration(): ProviderRegistration {
  const provider = new ManualPaymentProvider();
  return {
    key: "manual",
    capabilities: {
      settlesAtPayTime: true,
      deliversWebhooks: false,
      requiresMerchantCredentials: false,
      chargesOffSession: false,
      recordedByStaff: true,
    },
    backing: "real",
    create: () => provider,
  };
}

/**
 * The PLATFORM's own Stripe adapter (C2-2): one Stripe account for the whole platform, so it takes
 * no per-merchant credentials. It authorizes then captures (`!settlesAtPayTime`), calls back
 * through signed webhooks. It does NOT declare `chargesOffSession`: `StripePaymentProvider` is an
 * on-session contract (create → the payer confirms → capture) with no stored-method charge behind it,
 * so declaring it would advertise a capability nothing implements (the previous release did). Absent ⇒ the
 * offline in-memory stub, registered as `stub` — `verifyWebhook()` always true, money operations
 * no-ops — which the production boot guard refuses outside `local`. Enabled by default: the one
 * provider that existed before merchant configuration did.
 */
export function stripeRegistration(
  paymentProvider: PaymentProvider | undefined,
): ProviderRegistration {
  const provider = paymentProvider ?? new InMemoryPaymentProvider();
  return {
    key: "stripe",
    capabilities: {
      settlesAtPayTime: false,
      deliversWebhooks: true,
      requiresMerchantCredentials: false,
      chargesOffSession: false,
    },
    backing: provider instanceof InMemoryPaymentProvider ? "stub" : "real",
    enabledByDefault: true,
    configurationHint:
      "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to configure the real StripePaymentProvider (C2-2).",
    create: () => provider,
  };
}

export interface PaymentProviderRegistrationInputs {
  /** The platform's Stripe adapter. Absent ⇒ the offline stub (see {@link stripeRegistration}). */
  readonly paymentProvider?: PaymentProvider;
  /** Every provider registered from outside this service (Paymob, a fictional test provider, …). */
  readonly providerRegistrations?: readonly ProviderRegistration[];
}

/**
 * The complete, ordered list of registrations a deployment composes. ONE function feeds both
 * `wirePayments` and the production boot guard, so the guard checks exactly what would be served
 * rather than a parallel description of it. A registration whose key collides with a built-in is
 * refused by `PaymentProviderRegistry.from` — nothing can silently replace Stripe or COD.
 */
export function composePaymentProviderRegistrations(
  inputs: PaymentProviderRegistrationInputs,
): readonly ProviderRegistration[] {
  return [
    stripeRegistration(inputs.paymentProvider),
    cashOnDeliveryRegistration(),
    manualPaymentRegistration(),
    ...(inputs.providerRegistrations ?? []),
  ];
}
