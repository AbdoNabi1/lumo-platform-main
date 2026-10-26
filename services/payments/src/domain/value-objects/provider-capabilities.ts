/**
 * What a payment provider can DO, as declared by whoever registers it. The payments domain reasons
 * about these — never about a provider's name — so a provider it has never heard of behaves
 * correctly the moment it declares them. Each flag exists because a real branch in this context
 * used to test a hard-coded name:
 *
 *  - `settlesAtPayTime` — money is settled when the shopper pays / hands over cash, so there is no
 *    separate "request capture" step (was: the `DIRECT_CAPTURE` name set — Paymob and COD).
 *  - `deliversWebhooks` — the provider can call us back, so a webhook naming it can be authentic
 *    (was: `hasProviderWebhooks`, `provider !== "cod"`).
 *  - `requiresMerchantCredentials` — each merchant brings their own credentials for it, sealed in
 *    the vault, rather than the platform holding one account (was: the Paymob-only settings field
 *    and the Paymob-only branch of the resolver).
 *  - `chargesOffSession` — it can take a payment with no payer present (recurring billing). A
 *    provider without it must never be selectable for recurring billing. Declared now; nothing
 *    implements tokenization here.
 *  - `recordedByStaff` (optional) — staff RECORD a payment received outside the platform (the draft
 *    order's "Mark as paid"). Never offered to shoppers, never enabled in settings, never cash a
 *    courier collects.
 *
 * A capability is a fact about the provider, not a preference: nothing may rank providers by them.
 */
export interface ProviderCapabilities {
  readonly settlesAtPayTime: boolean;
  readonly deliversWebhooks: boolean;
  readonly requiresMerchantCredentials: boolean;
  readonly chargesOffSession: boolean;
  /**
   * Order operations Part 4: staff RECORD a payment received outside the platform (bank transfer,
   * InstaPay, a wallet) — the draft order's "Mark as paid". Never offered to shoppers, never enabled in
   * settings, accepted for a new payment without enablement (only a staff action selects it). Optional:
   * absent means false, so existing registrations are unchanged. Reserved for the built-in `manual`
   * provider: `composePaymentProviderRegistrations` refuses an external registration that declares it.
   */
  readonly recordedByStaff?: boolean;
}

/**
 * True for a provider that settles at pay time yet cannot call us back — nothing but an operator
 * confirming the money arrived (cash collected on delivery) can then mark it paid. Derived from the
 * two declared flags, not a fifth flag: it is exactly what `ConfirmCodCollection` used to test
 * with `provider === "cod"`.
 */
export function isSettledByOperatorConfirmation(capabilities: ProviderCapabilities): boolean {
  return capabilities.settlesAtPayTime && !capabilities.deliversWebhooks;
}

/**
 * Cash the courier collects on delivery: settled by an operator's confirmation, and NOT a payment staff
 * recorded as already received. The ONE rule the courier's "Collect" amount and the bulk "Mark cash as
 * received" use (Ruling 9) — a `manual` payment is never cash to collect.
 */
export function isCollectedOnDelivery(capabilities: ProviderCapabilities): boolean {
  return isSettledByOperatorConfirmation(capabilities) && capabilities.recordedByStaff !== true;
}
