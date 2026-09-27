import { describe, expect, it, vi } from "vitest";
import type { Clock, IdGenerator, OffSessionChargeRequest } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type {
  BillingTokenSealer,
  BillingTransactionCallbackVerifier,
  CardEnrolmentPort,
  CardTokenCallbackVerifier,
  FinanceLedgerPort,
  VerifiedCardToken,
  VerifiedInvoiceTransaction,
} from "./application/ports";
import { wireLicensing } from "./composition";

/**
 * G-74 (8) — Morbeh's billing TRANSACTION callback settles the merchant's FIRST invoice (started
 * interactively via `BeginCardEnrolment`), the last human step T14.5 left in Morbeh's own billing.
 *
 * SECURITY: `special_reference` (Paymob's echo of the enrolment idempotency key) is NOT signed
 * (`packages/psp-paymob/src/webhook-signature.ts`). Every test below drives the use case through a
 * verifier whose returned shape has no `specialReference`/`merchantOrderId` field at all — proving
 * the use case cannot read it even if a malicious body carries one (the bypass test below adds it
 * to the RAW body on purpose and confirms it is still ignored).
 */
const PLATFORM = "platform-tenant";
const MERCHANT = "merchant-1";
const GOOD_HMAC = "valid-card-token-hmac";
const TRANSACTION_HMAC = "valid-transaction-hmac";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const sealer: BillingTokenSealer = {
  backing: "real",
  seal: (tenantRef, token) => Promise.resolve(`sealed(${tenantRef}):${token}`),
  open: (_tenantRef, sealed) => Promise.resolve(sealed),
};

const cardTokenVerifier: CardTokenCallbackVerifier = {
  verify: (rawBody, signature) =>
    signature === GOOD_HMAC
      ? (JSON.parse(new TextDecoder().decode(rawBody)) as VerifiedCardToken)
      : null,
};

/** Accepts exactly one signature; a callback body is the `VerifiedInvoiceTransaction` as JSON — plus
 *  whatever extra (unsigned, attacker-controlled) fields a test adds, which the returned shape
 *  still carries structurally but `RecordInvoiceTransaction` never reads. */
const transactionVerifier: BillingTransactionCallbackVerifier = {
  verify: (rawBody, signature) =>
    signature === TRANSACTION_HMAC
      ? (JSON.parse(new TextDecoder().decode(rawBody)) as VerifiedInvoiceTransaction)
      : null,
};

/** Always succeeds; records every call so a test can prove whether a PSP charge was attempted. */
class FakeCharger {
  readonly calls: OffSessionChargeRequest[] = [];
  chargeStoredMethod(request: OffSessionChargeRequest): Promise<{ providerReference: string }> {
    this.calls.push(request);
    return Promise.resolve({ providerReference: `psp-${request.idempotencyKey}` });
  }
}

function setup(overrides: { financeLedger?: FinanceLedgerPort } = {}) {
  const time = { now: new Date("2026-10-01T00:00:00.000Z") };
  const clock: Clock = { now: () => time.now };
  const charger = new FakeCharger();
  let orders = 0;
  const enrolment: CardEnrolmentPort = {
    startCheckout: () => {
      orders += 1;
      return Promise.resolve({
        providerOrderId: `order-${orders}`,
        checkoutUrl: `https://pay.test/checkout/${orders}`,
      });
    },
  };
  const app = wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    platformTenantId: PLATFORM,
    ...(overrides.financeLedger === undefined ? {} : { financeLedger: overrides.financeLedger }),
    storedMethodBilling: { sealer, charger, enrolment, cardTokenVerifier, transactionVerifier },
  });
  return { app, charger, time };
}
type App = ReturnType<typeof setup>["app"];

let cardTokenCounter = 0;

/**
 * Creates, issues and begins the interactive first payment for a new invoice, THEN completes the
 * card-token callback so the stored method is `active` — exactly like the real flow, where Paymob
 * delivers both callbacks for one interactive checkout. This matters for `isSettled` below: with no
 * active card, `CollectInvoice` would throw `NoStoredPaymentMethodError` regardless of the invoice's
 * own status, making it useless as a probe for whether the TRANSACTION callback settled the invoice.
 */
async function enrolledInvoice(
  app: App,
  amountMinor = 149900,
  currency = "EGP",
): Promise<{ invoiceId: string; orderId: string }> {
  const created = await app.licensing.createInvoice({
    tenantRef: MERCHANT,
    subscriptionRef: "sub-first",
    currency,
    lineItems: [{ description: "First period", amountMinor }],
    tenantId: PLATFORM,
  });
  const invoiceId = (created.body as { id: string }).id;
  await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM });
  const begun = await app.licensing.beginCardEnrolment({ invoiceId, tenantId: PLATFORM });
  const orderId = (begun.body as { providerOrderId: string }).providerOrderId;

  cardTokenCounter += 1;
  const tokenBody: VerifiedCardToken = {
    tokenId: `token-${cardTokenCounter}`,
    token: `token-value-${cardTokenCounter}`,
    providerOrderId: orderId,
    maskedPan: "xxxx-xxxx-xxxx-2346",
    cardSubtype: "MasterCard",
  };
  const tokenRecorded = await app.licensing.recordCardToken({
    tenantId: PLATFORM,
    rawBody: bytesOf(tokenBody),
    signature: GOOD_HMAC,
  });
  expect(tokenRecorded.status).toBe(200);

  return { invoiceId, orderId };
}

function transactionBody(
  orderId: string,
  overrides: Partial<VerifiedInvoiceTransaction> = {},
): VerifiedInvoiceTransaction {
  return {
    transactionId: "txn-1",
    providerOrderId: orderId,
    amountMinor: 149900,
    currency: "EGP",
    success: true,
    pending: false,
    isAuth: false,
    isCapture: true,
    isVoided: false,
    isRefunded: false,
    errorOccured: false,
    ...overrides,
  };
}

function bytesOf(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

async function callback(app: App, body: unknown, signature = TRANSACTION_HMAC) {
  return app.licensing.recordInvoiceTransaction({
    tenantId: PLATFORM,
    rawBody: bytesOf(body),
    signature,
  });
}

/** Whether an invoice is `paid`: attempting to collect it makes no PSP call only when it already is. */
async function isSettled(app: App, charger: FakeCharger, invoiceId: string): Promise<boolean> {
  const before = charger.calls.length;
  const response = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
  expect(response.status).toBe(200);
  return charger.calls.length === before;
}

describe("a correctly signed success callback settles the enrolled invoice, and only that one", () => {
  it("marks the invoice paid and no other", async () => {
    const { app, charger } = setup();
    const target = await enrolledInvoice(app, 149900);
    const other = await enrolledInvoice(app, 5000);

    const recorded = await callback(app, transactionBody(target.orderId));

    expect(recorded.status).toBe(200);
    expect((recorded.body as { outcome: string }).outcome).toBe("paid");
    expect(await isSettled(app, charger, target.invoiceId)).toBe(true);
    expect(await isSettled(app, charger, other.invoiceId)).toBe(false);
  });

  it("posts the settlement to the Finance ledger exactly once, for the merchant and the signed amount", async () => {
    const postSettlement = vi.fn(() => Promise.resolve());
    const { app } = setup({ financeLedger: { postSettlement } });
    const { orderId } = await enrolledInvoice(app, 149900, "EGP");

    await callback(app, transactionBody(orderId, { transactionId: "txn-42" }));

    expect(postSettlement).toHaveBeenCalledTimes(1);
    expect(postSettlement).toHaveBeenCalledWith(MERCHANT, 149900, "EGP", "txn-42");
  });
});

describe("the bypass Paymob's own docs warn about (G-74 (8) security note)", () => {
  it("a callback whose special_reference names a DIFFERENT invoice than the signed order.id settles the order's own invoice, not the one the unsigned field names", async () => {
    const { app, charger } = setup();
    const a = await enrolledInvoice(app, 149900);
    const b = await enrolledInvoice(app, 50000);

    const maliciousBody = {
      ...transactionBody(a.orderId, { transactionId: "txn-bypass" }),
      // UNSIGNED, attacker-controlled — names invoice B. The real Paymob callback carries this as
      // `order.merchant_order_id`; a correlator that read it instead of `order.id` would settle B.
      specialReference: `${b.invoiceId}:0:enrol`,
    };

    const recorded = await callback(app, maliciousBody);

    expect(recorded.status).toBe(200);
    expect((recorded.body as { outcome: string }).outcome).toBe("paid");
    expect(await isSettled(app, charger, a.invoiceId)).toBe(true);
    expect(await isSettled(app, charger, b.invoiceId)).toBe(false);
  });
});

describe("authentication", () => {
  it("a bad signature is 401 and settles nothing", async () => {
    const { app, charger } = setup();
    const { invoiceId, orderId } = await enrolledInvoice(app);

    const recorded = await callback(app, transactionBody(orderId), "forged-signature");

    expect(recorded.status).toBe(401);
    expect(await isSettled(app, charger, invoiceId)).toBe(false);
  });
});

describe("amount and currency are checked against the invoice before it is trusted", () => {
  it("an amount mismatch settles nothing", async () => {
    const { app, charger } = setup();
    const { invoiceId, orderId } = await enrolledInvoice(app, 149900);

    const recorded = await callback(app, transactionBody(orderId, { amountMinor: 1 }));

    expect(recorded.status).toBe(200);
    expect((recorded.body as { outcome: string }).outcome).toBe("amount_mismatch");
    expect(await isSettled(app, charger, invoiceId)).toBe(false);
  });

  it("a currency mismatch settles nothing", async () => {
    const { app, charger } = setup();
    const { invoiceId, orderId } = await enrolledInvoice(app, 149900, "EGP");

    const recorded = await callback(app, transactionBody(orderId, { currency: "USD" }));

    expect(recorded.status).toBe(200);
    expect((recorded.body as { outcome: string }).outcome).toBe("currency_mismatch");
    expect(await isSettled(app, charger, invoiceId)).toBe(false);
  });
});

describe("replay safety — the invoice state machine, not a second guard", () => {
  it("a replayed success callback is a no-op, not a second Finance post", async () => {
    const postSettlement = vi.fn(() => Promise.resolve());
    const { app, charger } = setup({ financeLedger: { postSettlement } });
    const { invoiceId, orderId } = await enrolledInvoice(app);

    const first = await callback(app, transactionBody(orderId, { transactionId: "txn-1" }));
    const replay = await callback(app, transactionBody(orderId, { transactionId: "txn-1" }));

    expect((first.body as { outcome: string }).outcome).toBe("paid");
    expect((replay.body as { outcome: string }).outcome).toBe("already_paid");
    expect(postSettlement).toHaveBeenCalledTimes(1);
    expect(await isSettled(app, charger, invoiceId)).toBe(true);
  });

  it("a success:false callback after the invoice is already paid leaves it paid", async () => {
    const { app, charger } = setup();
    const { invoiceId, orderId } = await enrolledInvoice(app);
    await callback(app, transactionBody(orderId));

    const late = await callback(app, transactionBody(orderId, { success: false }));

    expect((late.body as { outcome: string }).outcome).toBe("ignored");
    expect(await isSettled(app, charger, invoiceId)).toBe(true);
  });
});

describe("signed flags that are not a settlement — each decided explicitly, never keyed off success alone", () => {
  const cases: readonly [string, Partial<VerifiedInvoiceTransaction>][] = [
    ["pending: true", { pending: true }],
    ["auth without capture", { isAuth: true, isCapture: false }],
    ["error_occured: true", { errorOccured: true }],
    ["voided", { isVoided: true }],
    ["refunded", { isRefunded: true }],
    ["declined (success: false)", { success: false }],
  ];

  it.each(cases)("%s does not mark the invoice paid", async (_label, overrides) => {
    const { app, charger } = setup();
    const { invoiceId, orderId } = await enrolledInvoice(app);

    const recorded = await callback(app, transactionBody(orderId, overrides));

    expect(recorded.status).toBe(200);
    expect((recorded.body as { outcome: string }).outcome).toBe("ignored");
    expect(await isSettled(app, charger, invoiceId)).toBe(false);
  });
});

describe("an order nobody enrolled", () => {
  it("settles nothing and is still acknowledged (2xx)", async () => {
    const { app } = setup();

    const recorded = await callback(app, transactionBody("order-that-was-never-started"));

    expect(recorded.status).toBe(200);
    expect((recorded.body as { outcome: string }).outcome).toBe("no_enrolment");
  });
});
