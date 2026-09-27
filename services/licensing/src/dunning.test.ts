import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type {
  BillingTokenSealer,
  BillingTransactionCallbackVerifier,
  CardEnrolmentPort,
  CardTokenCallbackVerifier,
} from "./application/ports";
import { DEFAULT_DUNNING_POLICY, type DunningPolicy } from "./application/dunning.use-cases";
import { wireLicensing } from "./composition";
import type { PlanSpec } from "./domain/value-objects/plan-spec";
import { RecordingPaymentProvider } from "./test-support/recording-payment-provider";
import { PlatformBillingPaymentsAdapter } from "./infrastructure/platform-billing-payments-adapter";

/**
 * T14.5 (dunning) — detection, retry schedule, grace period, state transitions as a machine, and
 * recovery reporting, on top of the WP-14 T14.4 renewal-billing machinery `platform-billing.test.ts`
 * already exercises. `grace` is this codebase's name for what the gap register calls `past_due` —
 * see `Subscription.status` in `domain/subscription.ts`; no second state was added.
 */
const PLATFORM = "platform-tenant";
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RETRY_DAYS = DEFAULT_DUNNING_POLICY.retryIntervalsDays[0] ?? 1;

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function spec(basePriceMinor: number): PlanSpec {
  return {
    limits: { maxProducts: 100 },
    featureEntitlements: ["basic_reports"],
    pricing: { basePriceMinor, currency: "EGP", billingCycle: "monthly", creditAllowances: {} },
  };
}

function setup() {
  const time = { now: new Date("2026-10-01T00:00:00.000Z") };
  const clock: Clock = { now: () => time.now };
  const provider = new RecordingPaymentProvider();
  const app = wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    platformTenantId: PLATFORM,
    payments: new PlatformBillingPaymentsAdapter({ provider }),
  });
  return { app, provider, time };
}
type App = ReturnType<typeof setup>["app"];

async function newPublishedVersion(app: App, tenantRef: string, price = 2900): Promise<string> {
  const plan = await app.licensing.createPlan({
    key: `growth-${tenantRef}`,
    name: "Growth",
    tier: "growth",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await app.licensing.createPlanDraft({
    planId,
    spec: spec(price),
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  await app.licensing.publishPlanVersion({ planId, planVersionId, tenantId: PLATFORM });
  return planVersionId;
}

async function activeSubscription(
  app: App,
  tenantRef: string,
  planVersionRef: string,
): Promise<string> {
  const created = await app.licensing.createSubscription({
    tenantRef,
    planVersionRef,
    tenantId: PLATFORM,
  });
  const subscriptionId = (created.body as { id: string }).id;
  await app.licensing.activateSubscription({ subscriptionId, tenantId: PLATFORM });
  return subscriptionId;
}

/** Bills the first renewal so the subscription has a due-yet-unbilled period, then fails it. */
async function billAndFail(app: App, provider: RecordingPaymentProvider, subscriptionId: string) {
  provider.declineCapture = true;
  const renewal = await app.licensing.billSubscriptionRenewal({
    subscriptionId,
    tenantId: PLATFORM,
  });
  expect((renewal.body as { status: string }).status).toBe("failed");
  provider.declineCapture = false;
  const invoiceId = (renewal.body as { invoiceId: string }).invoiceId;
  return invoiceId;
}

describe("listing subscriptions due for renewal / dunning retry", () => {
  it("lists a due renewal and excludes one not yet due", async () => {
    const { app, time } = setup();
    // A fresh subscription's first renewal falls due at its OWN activation instant (WP-14's
    // `ActivateSubscription`), so "not yet due" is modeled by activating the second subscription
    // LATER on the clock, then checking as of a moment between the two activations.
    const v1 = await newPublishedVersion(app, "merchant-1");
    const due = await activeSubscription(app, "merchant-1", v1);

    time.now = new Date("2026-10-02T00:00:00.000Z");
    const v2 = await newPublishedVersion(app, "merchant-2");
    await activeSubscription(app, "merchant-2", v2);

    time.now = new Date("2026-10-01T12:00:00.000Z"); // after merchant-1's due date, before merchant-2's
    const listed = await app.licensing.listSubscriptionsDueForRenewal({ tenantId: PLATFORM });
    expect((listed.body as { subscriptionIds: string[] }).subscriptionIds).toEqual([due]);
  });

  it("lists a subscription due for a dunning retry and excludes one not yet due", async () => {
    const { app, provider, time } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);
    await app.licensing.enterDunning({ subscriptionId, invoiceId, tenantId: PLATFORM });

    // Not due yet: the first retry is scheduled retryIntervalsDays[0] days out.
    let listed = await app.licensing.listSubscriptionsDueForDunningRetry({ tenantId: PLATFORM });
    expect((listed.body as { subscriptionIds: string[] }).subscriptionIds).toEqual([]);

    time.now = new Date(time.now.getTime() + FIRST_RETRY_DAYS * DAY_MS);
    listed = await app.licensing.listSubscriptionsDueForDunningRetry({ tenantId: PLATFORM });
    expect((listed.body as { subscriptionIds: string[] }).subscriptionIds).toEqual([
      subscriptionId,
    ]);
  });
});

describe("detection: a failed renewal enters dunning", () => {
  it("active -> grace, a retry is scheduled, and entered_grace is the raised event", async () => {
    const { app, provider } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);

    const entered = await app.licensing.enterDunning({
      subscriptionId,
      invoiceId,
      tenantId: PLATFORM,
    });
    expect(entered.status).toBe(200);
    expect((entered.body as { status: string }).status).toBe("grace");

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("licensing.subscription.entered_grace");
    expect(app.deliveredEventTypes).not.toContain("licensing.subscription.suspended");
  });

  it("is idempotent: entering dunning twice for the same failed invoice is a no-op", async () => {
    const { app, provider } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);

    const first = await app.licensing.enterDunning({
      subscriptionId,
      invoiceId,
      tenantId: PLATFORM,
    });
    const second = await app.licensing.enterDunning({
      subscriptionId,
      invoiceId,
      tenantId: PLATFORM,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body as { status: string }).status).toBe("grace");
  });

  it("refuses a SECOND invoice while already in grace, and keeps retrying the first one", async () => {
    const { app, provider, time } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const firstInvoiceId = await billAndFail(app, provider, subscriptionId);
    await app.licensing.enterDunning({
      subscriptionId,
      invoiceId: firstInvoiceId,
      tenantId: PLATFORM,
    });

    // A different invoice must not silently take over an open dunning cycle. Both silent outcomes
    // lose money: adopting it abandons the first invoice's retry schedule, and returning ok without
    // adopting it drops the second invoice with nobody ever told. A refusal is the one outcome the
    // scheduler logs as an error. Without this case the guard was untested — gutting it to `if
    // (true)` left all 124 licensing tests green.
    const second = await app.licensing.enterDunning({
      subscriptionId,
      invoiceId: "inv-a-different-one",
      tenantId: PLATFORM,
    });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain("different invoice");

    // And the schedule still points at the FIRST invoice, not the refused one.
    time.now = new Date(time.now.getTime() + FIRST_RETRY_DAYS * DAY_MS);
    const retried = await app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM });
    expect((retried.body as { invoiceId: string }).invoiceId).toBe(firstInvoiceId);
  });

  it("an illegal transition is refused by the machine, not by a caller's if: entering dunning from a non-active subscription", async () => {
    const { app } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const created = await app.licensing.createSubscription({
      tenantRef: "merchant-1",
      planVersionRef: v1,
      tenantId: PLATFORM,
    });
    const subscriptionId = (created.body as { id: string }).id;
    // Still `trial` — never activated.
    const entered = await app.licensing.enterDunning({
      subscriptionId,
      invoiceId: "inv-does-not-matter",
      tenantId: PLATFORM,
    });
    expect(entered.status).toBe(409);
    expect(JSON.stringify(entered.body)).toContain("trial");
  });
});

describe("recovery: a mid-grace retry that succeeds", () => {
  it("grace -> active, the invoice is paid, and recovery is reported via recovered_from_grace", async () => {
    const { app, provider, time } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);
    await app.licensing.enterDunning({ subscriptionId, invoiceId, tenantId: PLATFORM });
    time.now = new Date(time.now.getTime() + FIRST_RETRY_DAYS * DAY_MS);

    const retried = await app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM });
    expect(retried.status).toBe(200);
    const body = retried.body as { outcome: string; status: string; invoiceId: string };
    expect(body.outcome).toBe("recovered");
    expect(body.status).toBe("active");
    expect(provider.moved).toHaveLength(1); // the recovering charge actually moved money

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("licensing.subscription.recovered_from_grace");
  });
});

describe("retry schedule: a mid-grace retry that fails again", () => {
  it("stays in grace and reschedules the next attempt", async () => {
    const { app, provider, time } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);
    await app.licensing.enterDunning({ subscriptionId, invoiceId, tenantId: PLATFORM });
    time.now = new Date(time.now.getTime() + FIRST_RETRY_DAYS * DAY_MS);

    provider.declineCapture = true;
    const retried = await app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM });
    expect(retried.status).toBe(200);
    const body = retried.body as { outcome: string; status: string };
    expect(body.outcome).toBe("retry_scheduled");
    expect(body.status).toBe("grace");
    expect(provider.moved).toHaveLength(0);

    // Not due yet at the SAME instant — the next interval was pushed out.
    const notYet = await app.licensing.listSubscriptionsDueForDunningRetry({ tenantId: PLATFORM });
    expect((notYet.body as { subscriptionIds: string[] }).subscriptionIds).toEqual([]);
  });
});

describe("exhaustion: every scheduled retry fails", () => {
  it("grace -> expired via dunning_exhausted once maxAttempts is used up", async () => {
    const { app, provider, time } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);
    await app.licensing.enterDunning({ subscriptionId, invoiceId, tenantId: PLATFORM });

    provider.declineCapture = true;
    let last: { outcome: string; status: string } | undefined;
    for (const days of DEFAULT_DUNNING_POLICY.retryIntervalsDays) {
      time.now = new Date(time.now.getTime() + days * DAY_MS);
      const retried = await app.licensing.retryDunningInvoice({
        subscriptionId,
        tenantId: PLATFORM,
      });
      last = retried.body as { outcome: string; status: string };
    }

    expect(last?.outcome).toBe("exhausted");
    expect(last?.status).toBe("expired");
    expect(provider.moved).toHaveLength(0); // never collected — the subscription lost service, not money

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("licensing.subscription.dunning_exhausted");

    // The machine, not a caller's if: expired has no outgoing transitions, so a further retry is refused.
    const further = await app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM });
    expect(further.status).toBe(409);
  });
});

describe("double-charge protection (G-74 (10))", () => {
  it("the same dunning attempt run twice produces one charge", async () => {
    const { app, provider, time } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);
    await app.licensing.enterDunning({ subscriptionId, invoiceId, tenantId: PLATFORM });
    time.now = new Date(time.now.getTime() + FIRST_RETRY_DAYS * DAY_MS);

    await Promise.all([
      app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM }),
      app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM }),
    ]);

    expect(provider.moved).toHaveLength(1);
  });

  it("a PSP call that appears to time out, followed by a retry, still moves money once", async () => {
    const { app, provider, time } = setup();
    const v1 = await newPublishedVersion(app, "merchant-1");
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    const invoiceId = await billAndFail(app, provider, subscriptionId);
    await app.licensing.enterDunning({ subscriptionId, invoiceId, tenantId: PLATFORM });
    time.now = new Date(time.now.getTime() + FIRST_RETRY_DAYS * DAY_MS);

    // First call re-issues the invoice (failed -> issued) and collects. A second call arriving
    // before the first is known to have succeeded (modeled here by simply calling again once the
    // invoice is already `issued`, the exact crash-recovery shape `RetryDunningInvoice` documents)
    // must not re-issue (issued -> issued would throw) and must not double-charge.
    await Promise.all([
      app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM }),
      app.licensing.retryDunningInvoice({ subscriptionId, tenantId: PLATFORM }),
    ]);

    expect(provider.moved).toHaveLength(1);
    const invoice = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
    expect(invoice.status).toBe(200); // already paid — collecting again is a no-op, not a second charge
    expect(provider.moved).toHaveLength(1);
  });
});

describe("a merchant with no stored card (G-74 (1) x T14.5)", () => {
  const MERCHANT_TENANT = "merchant-tenant";

  const sealer: BillingTokenSealer = {
    backing: "real",
    seal: (tenantRef, token) => Promise.resolve(`sealed(${tenantRef}):${token}`),
    open: () => Promise.reject(new Error("no card sealed")),
  };
  const enrolment: CardEnrolmentPort = {
    startCheckout: () =>
      Promise.resolve({ providerOrderId: "order-x", checkoutUrl: "https://pay.test/x" }),
  };
  const cardTokenVerifier: CardTokenCallbackVerifier = { verify: () => null };
  const transactionVerifier: BillingTransactionCallbackVerifier = { verify: () => null };

  function setupStoredMethod() {
    const time = { now: new Date("2026-10-01T00:00:00.000Z") };
    const clock: Clock = { now: () => time.now };
    const calls: unknown[] = [];
    const charger = {
      chargeStoredMethod: (request: unknown) => {
        calls.push(request);
        return Promise.reject(new Error("unreachable: no card should ever be charged"));
      },
    };
    const app = wireLicensing({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      platformTenantId: PLATFORM,
      storedMethodBilling: { sealer, charger, enrolment, cardTokenVerifier, transactionVerifier },
    });
    return { app, calls, time };
  }

  it("the invoice fails visibly, no charge is attempted, and dunning still starts", async () => {
    const { app, calls } = setupStoredMethod();
    const v1 = await newPublishedVersion(app, MERCHANT_TENANT);
    const subscriptionId = await activeSubscription(app, MERCHANT_TENANT, v1);

    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });
    expect((renewal.body as { status: string }).status).toBe("failed");
    expect(calls).toHaveLength(0); // NoStoredPaymentMethodError refuses before any PSP call

    const invoiceId = (renewal.body as { invoiceId: string }).invoiceId;
    const entered = await app.licensing.enterDunning({
      subscriptionId,
      invoiceId,
      tenantId: PLATFORM,
    });
    expect((entered.body as { status: string }).status).toBe("grace");
  });
});

describe("the dunning policy asserts its own coherence at construction", () => {
  const wire = (dunningPolicy: DunningPolicy) =>
    wireLicensing({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock: { now: () => new Date("2026-10-01T00:00:00.000Z") },
      platformTenantId: PLATFORM,
      payments: new PlatformBillingPaymentsAdapter({ provider: new RecordingPaymentProvider() }),
      dunningPolicy,
    });

  it("refuses retryIntervalsDays that does not have exactly maxAttempts entries", () => {
    expect(() => wire({ maxAttempts: 3, retryIntervalsDays: [1, 3], gracePeriodDays: 11 })).toThrow(
      /exactly maxAttempts \(3\) entries, got 2/,
    );
  });

  it("refuses a grace period shorter than the day the last retry runs", () => {
    // The combination the default shipped with: retries out to day 11, grace recorded as 7. Nothing
    // enforces gracePeriodDays yet, so this never misbehaved at runtime — but it is the date the
    // merchant is shown, and a subscription still recoverable on day 11 whose own row says it lapsed
    // on day 7 is a number that becomes a lie the moment T14.6/T14.7 display it.
    expect(() =>
      wire({ maxAttempts: 3, retryIntervalsDays: [1, 3, 7], gracePeriodDays: 7 }),
    ).toThrow(
      /gracePeriodDays \(7\) must be at least the day the last retry runs \(sum of retryIntervalsDays = 11\)/,
    );
  });

  it("accepts a deliberately widened grace period", () => {
    expect(() =>
      wire({ maxAttempts: 3, retryIntervalsDays: [1, 3, 7], gracePeriodDays: 14 }),
    ).not.toThrow();
  });
});
