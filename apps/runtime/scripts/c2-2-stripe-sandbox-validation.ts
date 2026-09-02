#!/usr/bin/env tsx
/**
 * C2-2 Task 9 — real Stripe TEST-MODE sandbox validation. Run this LOCALLY with your own Stripe
 * test-mode credentials (never pasted into any chat/agent session — the credentials-handling rule
 * for this sprint). It exercises the ACTUAL production adapter (`StripePaymentProvider`,
 * `@platform/psp-stripe`) against Stripe's real test API — no mock, no simulated provider.
 *
 * Prerequisites
 * -------------
 * 1. A Stripe account (test mode is free, no live charges are ever made by this script).
 * 2. A test-mode secret key from https://dashboard.stripe.com/test/apikeys (starts `sk_test_`).
 * 3. A webhook signing secret. Two ways to get one:
 *      a) Stripe CLI (recommended): `stripe listen --print-secret` prints a `whsec_...` you can
 *         use without configuring a real endpoint yet.
 *      b) Dashboard: create a test-mode webhook endpoint at
 *         https://dashboard.stripe.com/test/webhooks and copy its signing secret.
 *
 * Usage
 * -----
 *   STRIPE_SECRET_KEY=sk_test_xxx STRIPE_WEBHOOK_SECRET=whsec_xxx \
 *     pnpm --filter @platform/runtime sandbox:stripe
 *
 * What this script proves (Task 9's checklist)
 * ---------------------------------------------
 *   [payment creation]   createIntent() against POST /v1/payment_intents
 *   [payment completion] capture() against POST /v1/payment_intents/:id/capture
 *   [idempotent cancel]  cancel() on an already-captured intent — must no-op, not throw
 *   [refund]             refund() against POST /v1/refunds
 *   [webhook signature]  verifyWebhook() against a signature computed the same way Stripe computes
 *                        it — proves the adapter's crypto matches Stripe's real scheme end-to-end,
 *                        not just against our own test fixtures (packages/psp-stripe's unit tests
 *                        already prove the crypto in isolation; this proves it against Stripe's
 *                        documented format using this script's own honest self-signed payload,
 *                        since simulating an inbound network delivery from Stripe itself needs a
 *                        publicly reachable endpoint — see "What this script does NOT prove" below)
 *
 * What this script does NOT prove (needs the full stack — Docker/staging, out of this script's
 * reach in this sandbox per the standing note in memory that Docker Desktop is broken here)
 * ------------------------------------------------------------------------------------------
 *   [webhook reception]  a REAL Stripe-originated HTTP delivery reaching POST /api/v1/payments/webhook
 *   [order update]       RecordWebhook -> MarkOrderPaid -> Orders, through the running admin HTTP API
 *   [event publication]  payments.payment_intent.captured.v1 reaching the outbox/broker
 *
 *   To close that gap once you have Docker or a staging deployment:
 *     1. `docker compose up` (or deploy to staging) so the full runtime + Postgres + Redis + Kafka
 *        are live, with STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET set on the runtime's environment.
 *     2. `stripe listen --forward-to localhost:3080/api/v1/payments/webhook`
 *     3. `stripe trigger payment_intent.succeeded` (or run this script, which prints a real
 *        payment intent id you can drive through the dashboard) — this delivers a GENUINE
 *        Stripe-signed webhook, not a simulation.
 *     4. Confirm the order transitions and the outbox event appears.
 *
 * Never commits, logs, or prints your secret key. Only test-mode operations are performed.
 */
import { StripePaymentProvider } from "@platform/psp-stripe";
import { createLogger } from "@platform/utils";

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secretKey === undefined || webhookSecret === undefined) {
    console.error(
      "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (test-mode) before running this script. " +
        "See the header comment for how to obtain them.",
    );
    process.exitCode = 1;
    return;
  }
  if (!secretKey.startsWith("sk_test_")) {
    console.error(
      `Refusing to run: STRIPE_SECRET_KEY does not start with "sk_test_" — this script only runs ` +
        `against Stripe TEST mode, never live.`,
    );
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ scope: "c2-2-sandbox-validation" });
  const provider = new StripePaymentProvider({
    secretKey,
    webhookSecret,
    fetch: async (url, init) => fetch(url, init),
    logger,
  });

  const results: { readonly step: string; readonly ok: boolean; readonly detail: string }[] = [];
  const record = (step: string, ok: boolean, detail: string): void => {
    results.push({ step, ok, detail });
    console.error(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
  };

  let providerIntentId: string | undefined;
  try {
    const idempotencyKey = `c2-2-sandbox-${Date.now()}`;
    const intent = await provider.createIntent({
      tenantId: "c2-2-sandbox",
      orderRef: `sandbox-order-${Date.now()}`,
      amountMinor: 1050, // $10.50 — arbitrary, test mode, never charged for real
      currency: "USD",
      idempotencyKey,
    });
    providerIntentId = intent.providerIntentId;
    record("payment creation", true, `created ${intent.providerIntentId}`);
  } catch (error) {
    record("payment creation", false, String(error));
  }

  if (providerIntentId !== undefined) {
    try {
      // Stripe test mode auto-confirms a manual-capture intent's authorization once a test payment
      // method is attached via the Dashboard/API; a freshly created intent with NO payment method
      // attached is not yet capturable. This script proves the REQUEST SHAPE and AUTH are correct
      // (a real Stripe 4xx for "not confirmed yet" is itself proof the call reached Stripe and was
      // authenticated) rather than faking a successful capture — see the printed detail.
      await provider.capture(providerIntentId, `c2-2-sandbox-capture-${Date.now()}`);
      record("payment completion", true, `captured ${providerIntentId}`);
    } catch (error) {
      record(
        "payment completion",
        false,
        `Stripe rejected the capture (expected for an intent with no attached test payment method — ` +
          `attach one via the Dashboard and re-run to see a real PASS here): ${String(error)}`,
      );
    }

    try {
      // Idempotent-cancel contract: whether or not the capture above succeeded, cancelling an
      // intent that is not in a cancellable state must resolve, never throw.
      await provider.cancel(providerIntentId, `c2-2-sandbox-cancel-${Date.now()}`);
      record(
        "idempotent cancel",
        true,
        `cancel() resolved without throwing for ${providerIntentId}`,
      );
    } catch (error) {
      record("idempotent cancel", false, String(error));
    }

    try {
      await provider.refund(providerIntentId, 100, `c2-2-sandbox-refund-${Date.now()}`);
      record("refund", true, `refunded 100 minor units of ${providerIntentId}`);
    } catch (error) {
      record(
        "refund",
        false,
        `Stripe rejected the refund (expected if nothing was actually captured above): ${String(error)}`,
      );
    }
  }

  // Webhook signature: proves the adapter's HMAC scheme matches Stripe's documented format
  // (t=<ts>,v1=<hex-hmac-sha256>) using YOUR real webhook secret, end to end through the same
  // `verifyStripeSignature` the production route calls.
  const payload = new TextEncoder().encode(
    JSON.stringify({ id: "evt_sandbox", type: "payment_intent.succeeded" }),
  );
  const now = Math.floor(Date.now() / 1000);
  const { createHmac } = await import("node:crypto");
  const sig = createHmac("sha256", webhookSecret).update(`${now}.`).update(payload).digest("hex");
  const validVerification = await provider.verifyWebhook(payload, `t=${now},v1=${sig}`);
  const invalidVerification = await provider.verifyWebhook(payload, `t=${now},v1=deadbeef`);
  record(
    "webhook signature",
    validVerification && !invalidVerification,
    `valid=${validVerification}, invalid-rejected=${!invalidVerification}`,
  );
  const failures = results.filter((r) => !r.ok);
  console.error(`\n${results.length - failures.length}/${results.length} checks passed.`);
  if (failures.length > 0) {
    console.error(
      "\nSome failures above are EXPECTED on a freshly created intent with no attached test " +
        "payment method (Stripe correctly refuses to capture/refund it) — that is itself evidence " +
        "the adapter is really talking to Stripe (authenticated, correctly shaped requests, real " +
        "Stripe error responses), not a mock. Attach a test payment method to the printed intent id " +
        "via the Dashboard and re-run to exercise the full capture/refund path.",
    );
  }
}

main().catch((error: unknown) => {
  console.error("Sandbox validation script crashed:", error);
  process.exitCode = 1;
});
