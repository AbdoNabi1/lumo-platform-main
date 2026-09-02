# C-01 — 35 of 39 bounded contexts run on in-memory repositories in the production API

| Field                      | Value                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**               | Critical                                                                                                                                               |
| **Area**                   | Composition / Infrastructure / Data integrity                                                                                                          |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                     |
| **Blocker verdict**        | **True blocker.** It _is_ a tracked, intentional deferral (`docs/KNOWN_GAPS.md` G-39), but a deferral that does not survive contact with production.   |
| **Public contract change** | **No** for the guardrail fix. **No** for the per-context fix either — it follows the existing additive `prisma?`/`tenantId?` optional-field precedent. |

---

## 1. Location

| File                                   | Lines            | What is there                                               |
| -------------------------------------- | ---------------- | ----------------------------------------------------------- |
| `apps/admin/src/composition.ts`        | 283–321          | The 39 `wireX(deps)` calls that build the production graph  |
| `apps/admin/src/composition.ts`        | 125–134          | The `prisma?` / `tenantId?` doc comment that admits the gap |
| `apps/runtime/src/api.ts`              | 31–47            | Passes `prisma` + `tenantId` into `createAdminHttpApi`      |
| `apps/runtime/src/api.ts`              | 17–21            | The comment stating 35 contexts stay in-memory              |
| `services/payments/src/composition.ts` | 40–44, 58, 68–75 | Representative: `PaymentsWiringDeps` has no `prisma` field  |
| `services/catalog/src/composition.ts`  | 47–58, 59–63     | Second representative, same shape                           |

**Contexts _with_ a Prisma composition branch (4):** `customer-360`, `feature-registry`, `finance`, `security`.
**Contexts _without_ one (35):** catalog, inventory, orders, identity, pricing, automation, analytics, cart, checkout, payments, fulfillment, shipping, promotions, recommendations, reporting, returns, reviews, search, notifications, content, coupons, localization, loyalty, seo, components, theme, experience, experimentation, feature-flags, pages, media, tenancy, licensing, platform-console, wishlist.

Determined by grepping `prisma` across all 41 `services/*/src/composition.ts` files. Six files matched; two of those six (`catalog`, `orders`) matched **prose in a comment only**:

```
services/catalog/src/composition.ts:79:  * ... Proves the slice in-process; Prisma + a real
services/orders/src/composition.ts:45:  * ... production composition (`apps/runtime`) supplies a real, Prisma-backed
```

---

## 2. Current implementation

`apps/runtime/src/api.ts:31–47` correctly threads production persistence into the admin API:

```ts
const app = await createAdminHttpApi({
  serializer: runtime.serializer,
  idGenerator: runtime.idGenerator,
  clock: runtime.clock,
  accessControl: runtime.accessControl,
  authenticator: runtime.authenticator,
  rateLimiter: runtime.rateLimiter,
  idempotencyKeys: runtime.idempotencyKeys,
  responseCache: runtime.redis.cache,
  health: runtime.health,
  prisma: runtime.prisma,                       // ← threaded through
  tenantId: runtime.config.TENANT_DEFAULT_ID,
  paymentVerification: new PrismaPaymentVerificationAdapter(...),
});
```

`apps/admin/src/composition.ts:282–321` then passes that same `deps` object to every context:

```ts
export function wireAdmin(deps: AdminWiringDeps): WiredAdmin {
  const catalog   = wireCatalog(deps);
  const inventory = wireInventory(deps);
  const orders    = wireOrders(deps);
  ...
  const payments  = wirePayments(deps);
  ...
}
```

But 35 of those `wireX` functions declare a deps type that has no `prisma` field at all, so the value is structurally discarded. `services/payments/src/composition.ts:40–44`:

```ts
export interface PaymentsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}
```

and then, unconditionally (lines 58, 68–75):

```ts
const outboxStore = new InMemoryOutboxStore();
...
const intents         = new InMemoryPaymentIntentRepository({ outbox: outboxWriter, context });
const unitOfWork      = new InMemoryUnitOfWork();
const paymentProvider = new InMemoryPaymentProvider();
const ordersPort      = new InMemoryOrdersAdapter();
const financePort     = new InMemoryFinanceAdapter();
const notifications   = new InMemoryNotificationAdapter();
const processedWebhooks = new InMemoryProcessedWebhookStore();
```

The codebase states this itself at `apps/admin/src/composition.ts:129–131`:

> _"The other 35 wired contexts have no Prisma composition branch of their own yet and are unaffected either way — this does not add one for them."_

**The Prisma repositories for these contexts exist and compile.** Cross-referencing every `services/*/src/infrastructure/prisma-*.ts` against its importers shows that for 32 of them the _only_ importer is the package barrel `src/index.ts` — a re-export with zero construction sites. `services/payments/src/index.ts:8–10` exports `PrismaPaymentIntentRepository`; nothing ever calls `new PrismaPaymentIntentRepository(...)`.

---

## 3. Why it is incorrect

The composition root's stated job (`apps/runtime/src/composition.ts:42–46`) is _"EVERY dependency is wired here — no application code instantiates infrastructure."_ For 35 contexts the production composition root wires a **test double** and the type system cannot object, because the deps interface never declared the capability.

Three specific defects:

1. **The failure mode is silent and type-safe.** Passing `prisma` to `wirePayments` is not an error — TypeScript's structural typing permits extra properties on an object literal passed via a variable. So the call site _looks_ correct, compiles, and passes tests, while discarding the argument.
2. **There is no boot-time assertion that production persistence is actually in effect.** `apps/runtime/src/composition.ts` fails closed on identity (lines 89–93) and on authorization (lines 111–119) — both throw outside `local`. It does not apply the same discipline to persistence, which is the one dependency whose absence destroys data rather than denying a request.
3. **The four contexts that do have a Prisma branch prove the pattern is understood.** `services/security/src/composition.ts:271–313` and `services/finance/src/composition.ts:189–204` implement exactly the right shape, including a fail-closed `tenantId` check. The defect is that the pattern was applied 4 times, not 39.

---

## 4. Production impact

**Data loss on every restart, and divergent state between replicas.**

`infrastructure/k8s/20-deployment-api.yaml:12` sets `replicas: 2`. Each pod holds an independent heap. Concretely:

- A product created through pod A does not exist on pod B. Identical `GET` requests return `200` or `404` depending on load-balancer routing.
- `infrastructure/k8s/20-deployment-api.yaml:17` sets `maxUnavailable: 0, maxSurge: 1` — a correct zero-downtime rollout that, here, destroys 100% of application state on every deploy.
- Orders, carts, payment intents, shipments, returns, and inventory levels vanish on restart, OOM, or eviction. The HPA (`40-autoscaling.yaml`) makes this worse: scaling out adds pods with empty state.
- Writes return `201 Created` and emit events. Nothing surfaces the loss. The e2e suite passes because it exercises a single in-process instance where in-memory persistence is indistinguishable from durable.

**Interaction with C-04 (must be read together).** 36 of the 129 tables declared in `schema.prisma` have no migration that creates them — and they belong to _exactly these_ contexts. So C-01 and C-04 currently mask each other. **Fixing C-01 alone converts silent data loss into an immediate runtime crash** (`relation "promotions.promotions" does not exist`). C-04 must land first or concurrently.

---

## 5. Smallest additive fix

This is the one finding where the honest answer is _there is no small complete fix_ — 35 contexts each need ~20 lines. But the smallest additive change that **removes the danger** is a boot-time guardrail, and it should land first.

### Step 1 — fail-closed guardrail (smallest, ~15 lines, do this first)

Add to `apps/runtime/src/composition.ts`, following the existing precedent at lines 89–93 and 111–119:

```ts
/** Contexts that own a Prisma composition branch today. Extend as each one is converted. */
const DURABLE_CONTEXTS = ["customer-360", "feature-registry", "finance", "security"] as const;

export function assertDurablePersistence(config: RuntimeConfig, wired: readonly string[]): void {
  if (config.APP_ENV === "local") return;
  const ephemeral = wired.filter((c) => !DURABLE_CONTEXTS.includes(c as never));
  if (ephemeral.length > 0) {
    throw new Error(
      `Refusing to boot outside APP_ENV=local: ${String(ephemeral.length)} contexts have no ` +
        `durable persistence and would lose all data on restart (G-39): ${ephemeral.join(", ")}`,
    );
  }
}
```

Called once from `startApi`. This is purely additive, changes no existing behaviour in `local` or in tests, and converts a silent data-loss defect into a loud, specific boot failure that names every remaining context.

### Step 2 — per-context conversion (the real work, 35 × ~20 lines)

For each context, replicate the shape already proven in `services/finance/src/composition.ts:189–204`:

```ts
export interface PaymentsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly prisma?: Database; // additive optional
  readonly tenantId?: string; // additive optional
}

export function wirePayments(deps: PaymentsWiringDeps): WiredPayments {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wirePayments: tenantId is required when prisma is provided (ADR-0008).");
    }
    // ... construct PrismaPaymentIntentRepository (already written and exported)
  }
  // existing in-memory branch unchanged
}
```

Every repository this needs **already exists**. This is wiring, not implementation.

**Suggested order** (by blast radius): orders → payments → inventory → cart → checkout → catalog → pricing → identity → shipping → fulfillment → returns → notifications → the remaining 23.

---

## 6. Public contract impact

**None.**

- Step 1 adds a new exported function and a boot-time check. No existing signature changes.
- Step 2 adds **optional** fields to each `XWiringDeps` interface. Existing callers that omit them compile and behave identically — this is the same additive pattern already shipped for `SecurityWiringDeps` (`services/security/src/composition.ts`) and `FinanceWiringDeps`.
- `WiredX` return types are unchanged, so all 352 admin routes, all controllers, and all tests are unaffected.

---

## 7. Blocker or intentional deferral?

**Both — and the deferral does not excuse it.**

It is genuinely tracked as an intentional deferral: `docs/KNOWN_GAPS.md` lists **G-39 — "Production context composition behind the admin facade (Prisma-backed wireX)"**, impact _"api serves in-memory data"_, priority **P1**, status **open**, blocked by _"none (worker slice is the reference)"_. `apps/runtime/src/api.ts:17–21` discloses it in the code. Nobody hid this.

But the deferral was made against a codebase that had never been deployed. The moment a deploy is contemplated, "the API serves in-memory data" stops being a roadmap item and becomes a data-loss defect. **The gap register itself rates it P1 with no blocker** — it is deferred for sequencing reasons, not technical ones.

**Verdict: true blocker. Must be closed, or the guardrail in Step 1 must make it impossible to deploy without closing it.**

---

## 8. How this was verified

- `git grep -n prisma -- 'services/*/src/composition.ts'` → 6 files; manual read confirmed 4 real branches, 2 comment-only matches.
- Every `services/*/src/infrastructure/prisma-*.ts` cross-referenced against its importers; 32 of 34 have `src/index.ts` as their sole importer.
- `services/payments/src/composition.ts` and `services/catalog/src/composition.ts` read in full.
- `apps/admin/src/composition.ts` (490 lines) and `apps/runtime/src/api.ts` read in full.
- No code was modified.
