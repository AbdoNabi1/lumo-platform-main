# C-05 — Payments cannot take money: no PSP adapter, `verifyWebhook` never called, no webhook ingress

| Field                      | Value                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | Critical                                                                                                                         |
| **Area**                   | Payments / Security / Commerce correctness                                                                                       |
| **Baseline**               | `main` @ `756bce3`                                                                                                               |
| **Blocker verdict**        | **True blocker.** The stub is an intentional offline reference; its _reachability from a production composition root_ is not.    |
| **Public contract change** | **No** for the guardrail. **No** for the webhook route (additive). The PSP adapter is new implementation, not a contract change. |

---

## 1. Location

| File                                                              | Lines | What is there                                                                           |
| ----------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| `services/payments/src/infrastructure/in-memory-port-adapters.ts` | 14–36 | `InMemoryPaymentProvider` — the **only** `implements PaymentProvider` in the repository |
| `services/payments/src/infrastructure/in-memory-port-adapters.ts` | 17–20 | `createIntent` returns a fabricated id                                                  |
| `services/payments/src/infrastructure/in-memory-port-adapters.ts` | 22–24 | `capture()` is a no-op                                                                  |
| `services/payments/src/infrastructure/in-memory-port-adapters.ts` | 34–36 | `verifyWebhook()` returns `true` unconditionally                                        |
| `packages/contracts/src/payment-provider.ts`                      | 29    | `verifyWebhook(payload, signature): Promise<boolean>` — declared                        |
| `services/payments/src/composition.ts`                            | 71    | `const paymentProvider = new InMemoryPaymentProvider();` — unconditional                |
| `services/payments/src/composition.ts`                            | 117   | `recordWebhook: new RecordWebhook({...})` — wired                                       |
| `services/payments/src/interfaces/payment.controller.ts`          | 87–88 | `recordWebhook` reachable on the controller                                             |
| `apps/admin/src/http/payments-routes.ts`                          | —     | **No webhook route exists in this file**                                                |
| `apps/admin/src/interfaces/payments.admin-controller.ts`          | 14    | Documents the omission                                                                  |

---

## 2. Current implementation

### 2a. The only PSP adapter is a stub

`git grep -l "implements PaymentProvider"` returns exactly one file.

```ts
// services/payments/src/infrastructure/in-memory-port-adapters.ts:14-36
export class InMemoryPaymentProvider implements PaymentProvider {
  private counter = 0;

  async createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    this.counter += 1;
    return { providerIntentId: `psp-intent-${request.orderRef}-${this.counter}` };
  }

  async capture(): Promise<void> {
    // Offline stub: no-op. Truth arrives via the webhook, per ADR-0012.
  }

  async cancel(): Promise<void> {
    // Idempotent no-op offline stub.
  }

  async refund(): Promise<void> {
    // Offline stub: no-op.
  }

  async verifyWebhook(): Promise<boolean> {
    return true;
  }
}
```

`wirePayments` constructs it with no injection seam — `PaymentsWiringDeps` (lines 40–44) declares only `serializer`, `idGenerator`, `clock`:

```ts
// services/payments/src/composition.ts:71
const paymentProvider = new InMemoryPaymentProvider();
```

### 2b. Signature verification has zero call sites

```
$ git grep -n "verifyWebhook(" -- '*.ts'
packages/contracts/src/payment-provider.ts:29:  verifyWebhook(payload: Uint8Array, signature: string): Promise<boolean>;
services/payments/src/infrastructure/in-memory-port-adapters.ts:34:  async verifyWebhook(): Promise<boolean> {
```

Two hits: the interface declaration and the stub implementation. **No code path in this repository invokes it.**

### 2c. There is no webhook ingress

`RecordWebhook` is constructed (`services/payments/src/composition.ts:117`) and reachable on the controller (`services/payments/src/interfaces/payment.controller.ts:87-88`), but `apps/admin/src/http/payments-routes.ts` defines no webhook route. The admin controller documents this:

```ts
// apps/admin/src/interfaces/payments.admin-controller.ts:14
 * capture/refund/get) — `advance` (generic) and `recordWebhook` are saga/PSP-internal, not
```

For contrast, Shipping _does_ expose a webhook — but behind admin RBAC, which no carrier can satisfy:

```ts
// apps/admin/src/http/shipping-routes.ts:105-113
path: "/shipments/:shipmentId/webhook",
version: 1,
permission: "shipping:record_webhook",     // ← no `public: true`
```

Only 5 routes in the entire admin surface carry `public: true`, all in `public-catalog-routes.ts` (products, categories, prices, inventory).

---

## 3. Why it is incorrect

Three distinct defects that compound:

1. **A test double is reachable from the production composition root with no way to override it.** Unlike `kms`, `crypto`, `threatIntel`, `identityDirectory`, and six other ports in `SecurityWiringDeps` — all of which have `deps.X ??` seams — `PaymentsWiringDeps` has no `paymentProvider` field. A real adapter cannot be injected without editing the composition root. The stub is correctly labelled _"Offline in-memory stub"_, but labelling is not enforcement.

2. **A declared security control with zero call sites is not a control.** `PaymentProvider.verifyWebhook` exists in `@platform/contracts` precisely so webhook authenticity can be established. Nothing calls it. Even if a real adapter were dropped in tomorrow, webhooks would still be unverified, because the _call_ is missing, not just the _implementation_.

3. **ADR-0012 designates the webhook as the source of payment truth, and there is no way for one to arrive.** `InMemoryPaymentProvider.capture()`'s own comment says _"Truth arrives via the webhook, per ADR-0012."_ No unauthenticated ingress exists for that webhook. The design is internally consistent and externally unreachable.

---

## 4. Production impact

**The platform cannot charge a customer, and would report that it had.**

Trace of a real purchase against this code:

1. `CreatePaymentIntentLifecycle` → `paymentProvider.createIntent()` → returns `psp-intent-<orderRef>-1`. This identifier corresponds to nothing at any acquirer.
2. `CapturePaymentLifecycle` → `paymentProvider.capture()` → returns successfully having moved no money.
3. The domain transitions the intent to `captured` and emits `payments.payment_intent.captured`.
4. `PaymentCapturedConsumer` → `MarkOrderPaid` → the order is recorded **paid**.
5. `PrismaPaymentVerificationAdapter` (`apps/runtime/src/composition.ts:164-170`) queries `payment_intents` for `status: "captured"` — and **finds the row**, because step 3 wrote it. The Sprint-A1 verification gate passes against the platform's own fabricated state.

Net result: **goods are released against payments that never occurred**, and the one control designed to catch it (H-08) validates against the same fabricated record.

Secondary impact if a real PSP is connected without fixing 2b: with zero `verifyWebhook` call sites, any party who discovers the webhook endpoint can forge a `captured` event. That is unauthenticated remote order fulfilment.

---

## 5. Smallest additive fix

Three changes, in this order. Only the first is small; the third is genuine implementation work and should not be understated.

### Step 1 — fail closed on the stub (smallest, ~12 lines, do this first)

Add an optional injection seam plus a production guard, following the exact precedent in `SecurityWiringDeps`:

```ts
// services/payments/src/composition.ts
export interface PaymentsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Live PSP adapter. Absent ⇒ the offline reference stub (tests/local only). */
  readonly paymentProvider?: PaymentProvider; // additive optional
  readonly appEnv?: "local" | "development" | "staging" | "production";
}

const paymentProvider =
  deps.paymentProvider ??
  (() => {
    if (deps.appEnv !== undefined && deps.appEnv !== "local") {
      throw new Error(
        "wirePayments: a real PaymentProvider is required outside APP_ENV=local — " +
          "InMemoryPaymentProvider fabricates PSP intent ids and no-ops capture().",
      );
    }
    return new InMemoryPaymentProvider();
  })();
```

This mirrors `apps/runtime/src/composition.ts:111-119`'s existing fail-closed authorization pattern. It changes nothing for tests or `local`, and makes it impossible to deploy the stub silently.

### Step 2 — add a verified public webhook route (~35 lines, additive)

A new `apps/admin/src/http/payments-webhook-routes.ts`, using the transport's existing `public: true` support (`packages/http/src/server.ts:203-221`) so no admin principal is required, and calling `verifyWebhook` **before** `recordWebhook`:

```ts
defineRoute({
  method: "POST",
  path: "/public/payments/webhook/:provider",
  version: 1,
  permission: "payments:record_webhook", // unused for public routes; kept for the schema
  public: true,
  idempotent: true,
  summary: "PSP webhook ingress (signature-verified, replay-safe)",
  schema: { params: providerParams, body: webhookBody },
  handle: async ({ params, body, context }) => {
    /* verify → recordWebhook */
  },
});
```

Two constraints that must not be missed:

- The raw request body is needed for signature verification. Fastify parses JSON before the handler, so a `rawBody` capture (content-type-scoped) is required. This is the only non-trivial part of Step 2.
- `route.idempotent` + `Idempotency-Key` already gives replay protection at the transport (`packages/http/src/server.ts:300-332`), and `InMemoryProcessedWebhookStore` gives it at the domain — the latter needs its Prisma counterpart via C-01.

### Step 3 — implement a real PSP adapter (substantive; no small fix exists)

A new package `@platform/psp-<provider>` implementing the existing `PaymentProvider` interface verbatim. The interface is already correct and complete; this is implementation, not design. Scope it as its own sprint. Steps 1 and 2 make it safe to ship _without_ Step 3 by refusing to boot.

---

## 6. Public contract impact

**None for Steps 1 and 2.**

- Step 1 adds **optional** fields to `PaymentsWiringDeps`. Existing callers compile and behave identically. `PaymentProvider` itself (`@platform/contracts`) is unchanged.
- Step 2 adds a **new** route at a new path. No existing route's method, path, schema, or response shape changes. It appears additively in the generated OpenAPI document.
- Step 3 adds a new package implementing an existing interface. No contract change.

---

## 7. Blocker or intentional deferral?

**Partly an intentional deferral — but the reachable-in-production part is a true blocker.**

What _is_ an intentional, documented deferral:

- The stub itself. `services/payments/src/infrastructure/in-memory-port-adapters.ts:9-12` says _"Production swaps these for the real per-tenant PSP adapters (`@platform/psp-<provider>`) + context adapters at the composition root — unchanged interface."_ That is a legitimate plan.
- `docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md` tracks this as **PAY-2** (CRIT, CONFIRMED → item A4) and **PAY-3** (CRIT, CONFIRMED → item A4), with the plan stating _"Deployment readiness remains NO until Phase A closes."_

What is **not** a deferral, and is a true blocker:

- The _absence of an injection seam_. The plan says production "swaps these at the composition root" — but `PaymentsWiringDeps` provides no field to swap. The swap the deferral depends on is structurally impossible today.
- The _absence of any `verifyWebhook` call site_. That is not a pending adapter; it is a missing call in code that exists.

I independently re-verified PAY-2 and PAY-3 against this HEAD. Both still hold.

**Verdict: true blocker.** Step 1 is what converts the deferral back into a safe one.

---

## 8. How this was verified

- `git grep -l "implements PaymentProvider" -- '*.ts'` → 1 file.
- `git grep -n "verifyWebhook(" -- '*.ts'` → 2 hits, both declarations.
- `services/payments/src/infrastructure/in-memory-port-adapters.ts` read in full.
- `services/payments/src/composition.ts` read in full (147 lines).
- `apps/admin/src/http/payments-routes.ts` searched for `webhook` → no matches.
- `git grep -n "recordWebhook" -- '*.ts'` → wired in composition/controller; routed only for Fulfillment and Shipping.
- `git grep -n "public: true" -- 'apps/admin/src/http/*.ts'` → 5 occurrences, all catalog reads.
- `apps/admin/src/http/shipping-routes.ts:105-113` read to confirm the carrier-webhook RBAC gate.
- No code was modified.
