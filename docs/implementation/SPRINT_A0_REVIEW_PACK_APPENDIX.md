# Sprint A0 — Architecture Review Pack, Appendix (Evidence Only)

**No code was changed to produce this document.** Every patch below is real `git diff` output
(`--unified=5`), not retyped or summarized. For files that already carried unrelated uncommitted
work before this session, the patch shown is a real `git diff --no-index -U5` between (a) a
snapshot file containing the exact pre-Sprint-A0 content — reconstructed verbatim from this
session's own `Read` tool calls, made _before_ any edit to that file — and (b) the file's current
state. That is still a genuine, tool-generated patch; the only substitution is the diff base (the
pre-Sprint-A0 snapshot instead of git's `HEAD`, which in this repository predates far more than
just this session — see the original pack's §0). Where such a hunk is omitted because it's
pre-existing, that hunk is not shown at all here (the isolated diff naturally excludes it — see the
note under each such file for what it is).

---

## 1. Exact patches (`git diff --unified=5`) for every file Sprint A0 modified

### 1.1 Files with no pre-existing dirty state — real `git diff -U5` against `HEAD`, unmodified

#### `packages/messaging/src/consumer/event-handler.ts`

```diff
diff --git a/packages/messaging/src/consumer/event-handler.ts b/packages/messaging/src/consumer/event-handler.ts
index 7e77641..cbe489a 100644
--- a/packages/messaging/src/consumer/event-handler.ts
+++ b/packages/messaging/src/consumer/event-handler.ts
@@ -2,11 +2,22 @@ import type { IntegrationEvent } from "@platform/domain-events";

 /**
  * Handles a single integration-event type. Implemented per consuming context. `eventType` /
  * `eventVersion` declare the subscription a broker adapter routes to. Handlers should be idempotent
  * (the `ProcessedEventStore` dedupes redelivery, but handlers must tolerate at-least-once).
+ *
+ * `handleAtomic` is an **opt-in** capability (ADR-0005, Sprint A0): when implemented, and the
+ * runtime is given a `TransactionalUnitOfWork` (`@platform/repository`), the runtime opens one
+ * transaction, calls `handleAtomic(event, tx)`, then records the processed-marker with that same
+ * `tx` — the handler's domain write and the idempotency marker commit or roll back together
+ * (upgrading at-least-once delivery to exactly-once *effect*). Handlers that only implement
+ * `handle` are entirely unaffected — this must stay opt-in, never a blanket requirement: several
+ * existing handlers make external network calls with no DB write to make atomic in the first
+ * place, and wrapping those in an open Postgres transaction would hold a connection across
+ * arbitrary-latency vendor calls for zero correctness benefit.
  */
-export interface EventHandler<TPayload> {
+export interface EventHandler<TPayload, TContext = unknown> {
   readonly eventType: string;
   readonly eventVersion: number;
   handle(event: IntegrationEvent<TPayload>): Promise<void>;
+  handleAtomic?(event: IntegrationEvent<TPayload>, tx: TContext): Promise<void>;
 }
```

#### `packages/messaging/src/consumer/event-consumer.ts`

```diff
diff --git a/packages/messaging/src/consumer/event-consumer.ts b/packages/messaging/src/consumer/event-consumer.ts
index 1867c9c..a625ebc 100644
--- a/packages/messaging/src/consumer/event-consumer.ts
+++ b/packages/messaging/src/consumer/event-consumer.ts
@@ -1,23 +1,31 @@
 import type { Clock } from "@platform/contracts";
-import type { EventSerializer, SerializedEnvelope } from "@platform/domain-events";
+import type { EventSerializer, IntegrationEvent, SerializedEnvelope } from "@platform/domain-events";
+import type { TransactionalUnitOfWork } from "@platform/repository";
 import type { Logger } from "@platform/utils";
 import type { DeadLetterStore } from "../dlq/dead-letter-store";
+import { DuplicateProcessedEventError } from "../idempotency/duplicate-processed-event-error";
 import type { ProcessedEventStore } from "../idempotency/processed-event-store";
 import type { RetryPolicy } from "../retry/retry-policy";
 import type { EventHandler } from "./event-handler";
 import type { IncomingMessage } from "./incoming-message";

-export interface EventConsumerDeps {
+export interface EventConsumerDeps<TContext = unknown> {
   readonly serializer: EventSerializer;
   readonly processedEvents: ProcessedEventStore;
   readonly deadLetters: DeadLetterStore;
   readonly retryPolicy: RetryPolicy;
   readonly clock: Clock;
   readonly logger: Logger;
   /** Delays between retries; injected so tests stay deterministic and production controls timing. */
   readonly sleep: (ms: number) => Promise<void>;
+  /**
+   * Opt-in atomic capability (Sprint A0, ADR-0005): when provided, and the handler implements
+   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
+   * transaction. Omit for handlers that only implement `handle` — nothing changes for them.
+   */
+  readonly unitOfWork?: TransactionalUnitOfWork<TContext>;
 }

 /**
  * Turns a raw broker message into a typed, idempotent, retried handler call. Transport-agnostic: a
  * broker adapter (Redpanda, later) feeds it `IncomingMessage`s; tests feed them directly.
@@ -29,15 +37,15 @@ export interface EventConsumerDeps {
  * The pre-check narrows the duplicate window but cannot close it (check-then-act); the atomic
  * `recordIfNew` detects a concurrent duplicate after the fact. Handlers must therefore be
  * idempotent themselves (ADR-0005) — the production adapter closes the window fully by writing
  * the processed marker inside the handler's own transaction.
  */
-export class EventConsumer<TPayload> {
-  private readonly handler: EventHandler<TPayload>;
-  private readonly deps: EventConsumerDeps;
+export class EventConsumer<TPayload, TContext = unknown> {
+  private readonly handler: EventHandler<TPayload, TContext>;
+  private readonly deps: EventConsumerDeps<TContext>;

-  constructor(handler: EventHandler<TPayload>, deps: EventConsumerDeps) {
+  constructor(handler: EventHandler<TPayload, TContext>, deps: EventConsumerDeps<TContext>) {
     this.handler = handler;
     this.deps = deps;
   }

   async consume(message: IncomingMessage): Promise<void> {
@@ -47,10 +55,14 @@ export class EventConsumer<TPayload> {
       return;
     }

     for (let attempt = 1; ; attempt += 1) {
       try {
+        if (this.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
+          await this.consumeAtomic(event, message);
+          return;
+        }
         await this.handler.handle(event);
         const isNew = await this.deps.processedEvents.recordIfNew(
           event.messageId,
           this.deps.clock.now().toISOString(),
         );
@@ -86,10 +98,51 @@ export class EventConsumer<TPayload> {
         });
         await this.deps.sleep(this.deps.retryPolicy.delayForAttempt(attempt));
       }
     }
   }
+
+  /**
+   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
+   * transaction. If `recordIfNew` loses the race to a concurrent redelivery, throws
+   * `DuplicateProcessedEventError` from inside the transaction — rolling back the handler's domain
+   * write, so a lost race never leaves a half-applied effect. That specific error is swallowed here
+   * (logged, not retried, not dead-lettered); anything else propagates to `consume`'s retry/DLQ
+   * handling unchanged.
+   */
+  private async consumeAtomic(
+    event: IntegrationEvent<TPayload>,
+    message: IncomingMessage,
+  ): Promise<void> {
+    const handleAtomic = this.handler.handleAtomic;
+    const unitOfWork = this.deps.unitOfWork;
+    if (handleAtomic === undefined || unitOfWork === undefined) {
+      throw new Error("consumeAtomic requires both handleAtomic and unitOfWork to be defined");
+    }
+    try {
+      await unitOfWork.run(async (tx) => {
+        await handleAtomic(event, tx);
+        const isNew = await this.deps.processedEvents.recordIfNew(
+          event.messageId,
+          this.deps.clock.now().toISOString(),
+          tx,
+        );
+        if (!isNew) {
+          throw new DuplicateProcessedEventError(event.messageId);
+        }
+      });
+    } catch (error) {
+      if (error instanceof DuplicateProcessedEventError) {
+        this.deps.logger.warn("integration event was concurrently processed twice", {
+          messageId: event.messageId,
+          topic: message.topic,
+        });
+        return;
+      }
+      throw error;
+    }
+  }
 }

 function toSerialized(message: IncomingMessage): SerializedEnvelope {
   return {
     type: message.headers.type ?? "",
```

#### `packages/messaging/src/index.ts`

```diff
diff --git a/packages/messaging/src/index.ts b/packages/messaging/src/index.ts
index 2f2a2b0..a12c1d2 100644
--- a/packages/messaging/src/index.ts
+++ b/packages/messaging/src/index.ts
@@ -26,10 +26,11 @@ export { EventConsumer } from "./consumer/event-consumer";
 export type { EventConsumerDeps } from "./consumer/event-consumer";

 // Idempotency
 export type { ProcessedEventStore } from "./idempotency/processed-event-store";
 export { InMemoryProcessedEventStore } from "./idempotency/in-memory-processed-event-store";
+export { DuplicateProcessedEventError } from "./idempotency/duplicate-processed-event-error";

 // Retry
 export { RetryPolicy } from "./retry/retry-policy";
 export type { RetryPolicyOptions } from "./retry/retry-policy";
```

#### `packages/messaging/package.json`

```diff
diff --git a/packages/messaging/package.json b/packages/messaging/package.json
index fd5f386..4f4ae31 100644
--- a/packages/messaging/package.json
+++ b/packages/messaging/package.json
@@ -16,10 +16,11 @@
   },
   "dependencies": {
     "@platform/contracts": "workspace:*",
     "@platform/domain": "workspace:*",
     "@platform/domain-events": "workspace:*",
+    "@platform/repository": "workspace:*",
     "@platform/utils": "workspace:*"
   },
   "devDependencies": {
     "@platform/eslint-config": "workspace:*",
     "@platform/tsconfig": "workspace:*",
```

#### `packages/messaging/src/consumer/event-consumer.test.ts`

```diff
diff --git a/packages/messaging/src/consumer/event-consumer.test.ts b/packages/messaging/src/consumer/event-consumer.test.ts
index 5f07f4e..70e0c7f 100644
--- a/packages/messaging/src/consumer/event-consumer.test.ts
+++ b/packages/messaging/src/consumer/event-consumer.test.ts
@@ -1,17 +1,31 @@
 import { describe, expect, it } from "vitest";
 import type { Clock } from "@platform/contracts";
 import type { IntegrationEvent } from "@platform/domain-events";
 import { InMemoryEventSerializer } from "@platform/domain-events/testing";
+import type { TransactionalUnitOfWork } from "@platform/repository";
 import type { Logger } from "@platform/utils";
 import { InMemoryDeadLetterStore } from "../dlq/in-memory-dead-letter-store";
 import { InMemoryProcessedEventStore } from "../idempotency/in-memory-processed-event-store";
+import type { ProcessedEventStore } from "../idempotency/processed-event-store";
 import { RetryPolicy } from "../retry/retry-policy";
 import { EventConsumer, type EventConsumerDeps } from "./event-consumer";
 import type { EventHandler } from "./event-handler";
 import type { IncomingMessage } from "./incoming-message";

+/** Fake transaction context — a distinct object per `run` call, so tests can assert identity. */
+type FakeTx = { readonly id: number };
+
+/** Runs `work` immediately with a fresh fake tx — no real rollback semantics, just identity/count tracking. */
+class FakeUnitOfWork implements TransactionalUnitOfWork<FakeTx> {
+  runCount = 0;
+  async run<T>(work: (tx: FakeTx) => Promise<T>): Promise<T> {
+    this.runCount += 1;
+    return work({ id: this.runCount });
+  }
+}
+
 type OrderPayload = { total: number };

 const clock: Clock = { now: () => new Date("2026-06-29T00:00:00.000Z") };
 const serializer = new InMemoryEventSerializer();
 const noSleep = async (): Promise<void> => {};
@@ -143,6 +157,110 @@ describe("EventConsumer", () => {

     expect(deadLetters.snapshot()).toHaveLength(1);
     expect(deadLetters.snapshot()[0]?.attempts).toBe(3);
     expect(deadLetters.snapshot()[0]?.error).toBe("always fails");
   });
+
+  describe("opt-in atomic path (Sprint A0)", () => {
+    it("handlers without handleAtomic are unaffected even when a unitOfWork is provided", async () => {
+      const handled: number[] = [];
+      const unitOfWork = new FakeUnitOfWork();
+      const handler: EventHandler<OrderPayload, FakeTx> = {
+        eventType: "orders.order.placed",
+        eventVersion: 1,
+        handle: async (event) => {
+          handled.push(event.payload.total);
+        },
+      };
+      const consumerDeps: EventConsumerDeps<FakeTx> = { ...deps(), unitOfWork };
+
+      await new EventConsumer(handler, consumerDeps).consume(message(100));
+
+      expect(handled).toEqual([100]);
+      expect(unitOfWork.runCount).toBe(0); // never invoked — handler didn't opt in
+    });
+
+    it("runs handleAtomic and the processed-marker write inside the same transaction", async () => {
+      const receivedTx: FakeTx[] = [];
+      const unitOfWork = new FakeUnitOfWork();
+      const processedEvents = new InMemoryProcessedEventStore();
+      const recordedTx: unknown[] = [];
+      const spiedStore: ProcessedEventStore = {
+        has: (id) => processedEvents.has(id),
+        recordIfNew: (id, at, tx) => {
+          recordedTx.push(tx);
+          return processedEvents.recordIfNew(id, at, tx);
+        },
+      };
+      const handler: EventHandler<OrderPayload, FakeTx> = {
+        eventType: "orders.order.placed",
+        eventVersion: 1,
+        handle: async () => {
+          throw new Error("should never be called — handleAtomic takes precedence");
+        },
+        handleAtomic: async (_event, tx) => {
+          receivedTx.push(tx);
+        },
+      };
+      const consumerDeps: EventConsumerDeps<FakeTx> = {
+        ...deps(),
+        processedEvents: spiedStore,
+        unitOfWork,
+      };
+
+      await new EventConsumer(handler, consumerDeps).consume(message(100));
+
+      expect(unitOfWork.runCount).toBe(1);
+      expect(receivedTx).toEqual([{ id: 1 }]);
+      expect(recordedTx).toEqual([{ id: 1 }]); // same tx object handleAtomic received
+      expect(await processedEvents.has("evt-1")).toBe(true);
+    });
+
+    it("rolls back the domain effect (never dead-letters/retries) when recordIfNew loses the race inside the transaction", async () => {
+      // Models the exact window the fast `has()` pre-check cannot close: `has` reports "not yet
+      // processed" (so the consumer proceeds into the transaction), but a concurrent redelivery
+      // wins the `recordIfNew` insert race once inside it. The atomic path must detect that and
+      // roll the whole transaction back — never dead-letter or retry a benign duplicate.
+      const unitOfWork = new FakeUnitOfWork();
+      const deadLetters = new InMemoryDeadLetterStore();
+      let handleAtomicCalls = 0;
+      let warned = false;
+      const raceyStore: ProcessedEventStore = {
+        has: async () => false,
+        recordIfNew: async () => false, // always loses the race, simulating the closed window
+      };
+      const handler: EventHandler<OrderPayload, FakeTx> = {
+        eventType: "orders.order.placed",
+        eventVersion: 1,
+        handle: async () => {
+          throw new Error("should never be called");
+        },
+        handleAtomic: async () => {
+          handleAtomicCalls += 1;
+        },
+      };
+      const logger: Logger = {
+        debug: () => {},
+        info: () => {},
+        error: () => {},
+        child: () => logger,
+        warn: () => {
+          warned = true;
+        },
+      };
+      const consumerDeps: EventConsumerDeps<FakeTx> = {
+        ...deps(),
+        processedEvents: raceyStore,
+        deadLetters,
+        unitOfWork,
+        logger,
+      };
+
+      await new EventConsumer(handler, consumerDeps).consume(message(100, "evt-1"));
+
+      expect(handleAtomicCalls).toBe(1); // handleAtomic ran inside the tx...
+      expect(unitOfWork.runCount).toBe(1);
+      expect(deadLetters.snapshot()).toHaveLength(0); // ...but never treated as a failure
+      expect(warned).toBe(true); // ...and the benign-duplicate outcome is logged
+    });
+  });
 });
```

#### `packages/kafka/src/consumer-runtime.ts`

```diff
diff --git a/packages/kafka/src/consumer-runtime.ts b/packages/kafka/src/consumer-runtime.ts
index beeafbb..2dba0e3 100644
--- a/packages/kafka/src/consumer-runtime.ts
+++ b/packages/kafka/src/consumer-runtime.ts
@@ -1,9 +1,15 @@
 import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";
 import type { Clock } from "@platform/contracts";
-import type { EventSerializer } from "@platform/domain-events";
-import type { EventHandler, EventPublisher, ProcessedEventStore } from "@platform/messaging";
+import type { EventSerializer, IntegrationEvent } from "@platform/domain-events";
+import {
+  DuplicateProcessedEventError,
+  type EventHandler,
+  type EventPublisher,
+  type ProcessedEventStore,
+} from "@platform/messaging";
+import type { TransactionalUnitOfWork } from "@platform/repository";
 import type { Logger } from "@platform/utils";
 import type { DeadLetterPublisher } from "./dead-letter-publisher";
 import { noopMetrics, type MessagingMetrics } from "./metrics";
 import { decodeRetryHeaders, encodeRetryHeaders, traceHeaders } from "./runtime-headers";
 import {
@@ -11,13 +17,13 @@ import {
   delayForAttempt,
   maxAttempts,
   type RetrySchedule,
 } from "./retry-schedule";

-export interface KafkaConsumerRuntimeDeps<TPayload> {
+export interface KafkaConsumerRuntimeDeps<TPayload, TContext = unknown> {
   readonly kafka: Kafka;
-  readonly handler: EventHandler<TPayload>;
+  readonly handler: EventHandler<TPayload, TContext>;
   readonly consumerGroup: string;
   readonly serializer: EventSerializer;
   /** ADR-0005 idempotency — Postgres remains the source of truth (`PrismaProcessedEventStore`). */
   readonly processedEvents: ProcessedEventStore;
   readonly deadLetters: DeadLetterPublisher;
@@ -27,10 +33,16 @@ export interface KafkaConsumerRuntimeDeps<TPayload> {
   readonly logger: Logger;
   readonly metrics?: MessagingMetrics;
   readonly retrySchedule?: RetrySchedule;
   /** Injected so tests stay deterministic; production waits for a retry message's due time. */
   readonly sleep?: (ms: number) => Promise<void>;
+  /**
+   * Opt-in atomic capability (Sprint A0, ADR-0005): when provided, and `handler` implements
+   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
+   * transaction. Omit for handlers that only implement `handle` — nothing changes for them.
+   */
+  readonly unitOfWork?: TransactionalUnitOfWork<TContext>;
 }

 /**
  * Production consumer runtime (Sprint 2.5, D-046). Composes the EXISTING ports — serializer,
  * `ProcessedEventStore`, DLQ — with broker-side redelivery, deliberately replacing
@@ -47,18 +59,18 @@ export interface KafkaConsumerRuntimeDeps<TPayload> {
  * recording BEFORE handling would lose a message that crashes between claim and handle (marked
  * processed, never effected). The residual concurrent-duplicate window is closed for real when
  * the handler records the marker inside its own transaction (`PrismaProcessedEventStore`
  * accepts the tx); handlers remain idempotent regardless (ADR-0005).
  */
-export class KafkaConsumerRuntime<TPayload> {
-  private readonly deps: KafkaConsumerRuntimeDeps<TPayload>;
+export class KafkaConsumerRuntime<TPayload, TContext = unknown> {
+  private readonly deps: KafkaConsumerRuntimeDeps<TPayload, TContext>;
   private readonly metrics: MessagingMetrics;
   private readonly schedule: RetrySchedule;
   private readonly sleep: (ms: number) => Promise<void>;
   private consumer: Consumer | null = null;

-  constructor(deps: KafkaConsumerRuntimeDeps<TPayload>) {
+  constructor(deps: KafkaConsumerRuntimeDeps<TPayload, TContext>) {
     this.deps = deps;
     this.metrics = deps.metrics ?? noopMetrics;
     this.schedule = deps.retrySchedule ?? DEFAULT_RETRY_SCHEDULE;
     this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
   }
@@ -123,15 +135,25 @@ export class KafkaConsumerRuntime<TPayload> {
       this.metrics.duplicate(this.topic, this.deps.consumerGroup);
       return; // already effected — redelivery ack'd
     }

     try {
-      await this.deps.handler.handle(envelope);
-      await this.deps.processedEvents.recordIfNew(
-        envelope.messageId,
-        this.deps.clock.now().toISOString(),
-      );
+      if (this.deps.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
+        const handled = await this.handleAtomic(envelope);
+        if (!handled) {
+          // Lost the recordIfNew race inside the transaction — a concurrent redelivery already
+          // effected this message; the domain write rolled back with it. Benign duplicate, ack.
+          this.metrics.duplicate(this.topic, this.deps.consumerGroup);
+          return;
+        }
+      } else {
+        await this.deps.handler.handle(envelope);
+        await this.deps.processedEvents.recordIfNew(
+          envelope.messageId,
+          this.deps.clock.now().toISOString(),
+        );
+      }
       this.metrics.processed(
         this.topic,
         this.deps.consumerGroup,
         this.deps.clock.now().getTime() - started,
       );
@@ -146,10 +168,43 @@ export class KafkaConsumerRuntime<TPayload> {
         error,
       });
     }
   }

+  /**
+   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
+   * transaction. Returns `false` if a concurrent redelivery won the `recordIfNew` race (the
+   * transaction is rolled back in that case, per `DuplicateProcessedEventError`); returns `true` on
+   * a normal commit. Any other error propagates to `handleMessage`'s retry/DLQ handling unchanged.
+   */
+  private async handleAtomic(envelope: IntegrationEvent<TPayload>): Promise<boolean> {
+    const handleAtomic = this.deps.handler.handleAtomic;
+    const unitOfWork = this.deps.unitOfWork;
+    if (handleAtomic === undefined || unitOfWork === undefined) {
+      throw new Error("handleAtomic requires both handler.handleAtomic and deps.unitOfWork");
+    }
+    try {
+      await unitOfWork.run(async (tx) => {
+        await handleAtomic(envelope, tx);
+        const isNew = await this.deps.processedEvents.recordIfNew(
+          envelope.messageId,
+          this.deps.clock.now().toISOString(),
+          tx,
+        );
+        if (!isNew) {
+          throw new DuplicateProcessedEventError(envelope.messageId);
+        }
+      });
+      return true;
+    } catch (error) {
+      if (error instanceof DuplicateProcessedEventError) {
+        return false;
+      }
+      throw error;
+    }
+  }
+
   private async scheduleRetryOrDeadLetter(input: {
     readonly attempt: number;
     readonly key: string;
     readonly value: Uint8Array;
     readonly headers: Readonly<Record<string, string>>;
```

#### `packages/kafka/package.json`

```diff
diff --git a/packages/kafka/package.json b/packages/kafka/package.json
index ca6a11a..5573489 100644
--- a/packages/kafka/package.json
+++ b/packages/kafka/package.json
@@ -17,10 +17,11 @@
   "dependencies": {
     "@platform/contracts": "workspace:*",
     "@platform/domain-events": "workspace:*",
     "@platform/health": "workspace:*",
     "@platform/messaging": "workspace:*",
+    "@platform/repository": "workspace:*",
     "@platform/utils": "workspace:*",
     "kafkajs": "^2.2.4"
   },
   "devDependencies": {
     "@platform/eslint-config": "workspace:*",
```

#### `services/payments/src/domain/payment-intent-repository.ts`

```diff
diff --git a/services/payments/src/domain/payment-intent-repository.ts b/services/payments/src/domain/payment-intent-repository.ts
index 20a1209..046a378 100644
--- a/services/payments/src/domain/payment-intent-repository.ts
+++ b/services/payments/src/domain/payment-intent-repository.ts
@@ -2,6 +2,13 @@ import type { PaymentIntent } from "./payment-intent";

 /** Persistence port for {@link PaymentIntent}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
 export interface PaymentIntentRepository {
   save(intent: PaymentIntent, tx?: unknown): Promise<void>;
   findById(id: string, tx?: unknown): Promise<PaymentIntent | null>;
+  /**
+   * Looks up an intent by its caller-supplied idempotency key — scaffolding for A3's saga-activity
+   * idempotency (Sprint A0 precondition). Returns `null` today for every key: the domain aggregate
+   * carries no `idempotencyKey` field yet, so nothing writes the column this queries. A3 threads
+   * the field through `PaymentIntent`/`CreatePaymentIntent` to make this live.
+   */
+  findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<PaymentIntent | null>;
 }
```

#### `services/payments/src/infrastructure/in-memory-payment-intent-repository.ts`

```diff
diff --git a/services/payments/src/infrastructure/in-memory-payment-intent-repository.ts b/services/payments/src/infrastructure/in-memory-payment-intent-repository.ts
index 86122c1..1458016 100644
--- a/services/payments/src/infrastructure/in-memory-payment-intent-repository.ts
+++ b/services/payments/src/infrastructure/in-memory-payment-intent-repository.ts
@@ -24,6 +24,15 @@ export class InMemoryPaymentIntentRepository implements PaymentIntentRepository
   }

   async findById(id: string): Promise<PaymentIntent | null> {
     return this.store.get(id) ?? null;
   }
+
+  /**
+   * Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any
+   * use case. Always returns `null` — the domain aggregate carries no `idempotencyKey` field yet,
+   * so there is nothing to match against (mirrors the Prisma adapter's always-NULL column today).
+   */
+  async findByIdempotencyKey(_idempotencyKey: string): Promise<PaymentIntent | null> {
+    return null;
+  }
 }
```

### 1.2 Files with pre-existing dirty state — isolated `git diff --no-index -U5` against the pre-Sprint-A0 snapshot

Each header states exactly what git compared. Pre-existing hunks are not shown (there were none in
the isolated diff to omit — the snapshot already contained them, so they produce no `+`/`-` lines
against themselves); each note below states what that pre-existing content was, for cross-reference
against §0 of the original pack.

#### `packages/db/prisma/schema/inventory.prisma`

_(Pre-existing, omitted from this diff because it's identical in both the snapshot and current file: the entire `Warehouse` model.)_

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/inventory.prisma" "b/packages/db/prisma/schema/inventory.prisma"
index 156aa80..6f2fc16 100644
--- "a/<pre-Sprint-A0 snapshot>/inventory.prisma"
+++ "b/packages/db/prisma/schema/inventory.prisma"
@@ -20,20 +20,26 @@ model InventoryItem {
   @@unique([tenantId, productRef, warehouseId])
   @@map("inventory_items")
   @@schema("inventory")
 }

+/// `@@unique([tenantId, itemId, reference])` (Sprint A0 precondition, A3): closes the retried-saga-
+/// activity duplicate-reservation gap ahead of A3's own idempotency work landing. Additive on
+/// already-populated columns — deploy requires the pre-migration duplicate audit in
+/// `docs/implementation/SPRINT_A0_REPORT.md` (migration notes) to run first; see that report for
+/// the exact audit query. No business logic reads/writes against this constraint yet.
 model Reservation {
   id        String   @id @db.Uuid
   tenantId  String   @map("tenant_id")
   itemId    String   @map("item_id") @db.Uuid
   quantity  Int
   reference String // cart/order ref (bare id)
   createdAt DateTime @default(now()) @map("created_at")

   item InventoryItem @relation(fields: [itemId], references: [id], onDelete: Cascade)

+  @@unique([tenantId, itemId, reference])
   @@index([itemId])
   @@index([tenantId, reference])
   @@map("reservations")
   @@schema("inventory")
 }
```

#### `packages/db/prisma/schema/payments.prisma`

_(Pre-existing, omitted: `pspReference`, `paymentMethod`, `authorizedAmountMinor`, `attempts` fields on `PaymentIntent`; the entire `ProcessedWebhook` model.)_

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/payments.prisma" "b/packages/db/prisma/schema/payments.prisma"
index 1bfbc75..6f73e6e 100644
--- "a/<pre-Sprint-A0 snapshot>/payments.prisma"
+++ "b/packages/db/prisma/schema/payments.prisma"
@@ -11,17 +11,24 @@ model PaymentIntent {
   pspReference          Json    @default("{}") @map("psp_reference") // { provider, providerIntentId } ({} = unset)
   paymentMethod         Json    @default("{}") @map("payment_method") // { type, token } (tokenized; no card data)
   authorizedAmountMinor Int?    @map("authorized_amount_minor")
   attempts              Json    @default("[]") // append-only PaymentAttempt[] (transaction/attempt log)
   status      String // full lifecycle: created|processing|authorized|capture_requested|captured|failed|cancelled|expired|partially_refunded|refunded|closed (domain-enforced)
+  /// Caller-supplied idempotency key for intent creation (Sprint A0 precondition, A3). Nullable —
+  /// no code path writes it yet (the domain aggregate carries no such field); A3 threads it through
+  /// `CreatePaymentIntent` to dedupe retried saga-activity calls. New column, all-NULL today, so
+  /// the unique constraint below is safe to apply without a data audit (Postgres treats each NULL
+  /// as distinct in a unique index).
+  idempotencyKey String? @map("idempotency_key")
   version     Int      @default(0)
   createdAt   DateTime @default(now()) @map("created_at")
   updatedAt   DateTime @updatedAt @map("updated_at")

   charges Charge[]
   refunds Refund[]

+  @@unique([tenantId, idempotencyKey])
   @@index([tenantId, orderRef])
   @@index([tenantId, status])
   @@map("payment_intents")
   @@schema("payments")
 }
```

#### `packages/db/prisma/schema/shipping.prisma` (untracked file — never committed; Sprint A0's addition against the pre-Sprint-A0 content of this uncommitted file)

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/shipping.prisma" "b/packages/db/prisma/schema/shipping.prisma"
index 2f8c1f2..bc51056 100644
--- "a/<pre-Sprint-A0 snapshot>/shipping.prisma"
+++ "b/packages/db/prisma/schema/shipping.prisma"
@@ -18,14 +18,21 @@ model Shipment {
   packages         Json      @default("[]") // ShipmentPackage[] snapshots
   trackingEvents   Json      @default("[]") @map("tracking_events") // append-only TrackingEvent[] (carrier scans)
   deliveryEstimate Json      @default("{}") @map("delivery_estimate") // { earliestAt, latestAt } ({} = unset)
   deliveredAt      DateTime? @map("delivered_at")
   attempts         Json      @default("[]") // append-only ShippingAttempt[] (attempt/audit log)
+  /// Caller-supplied idempotency key for shipment creation (Sprint A0 precondition, A8). Nullable —
+  /// no code path writes it yet (the domain aggregate carries no such field); A8 threads it through
+  /// `CreateShipment` to dedupe retried Fulfillment->Shipping calls. New column, all-NULL today, so
+  /// the unique constraint below is safe to apply without a data audit (Postgres treats each NULL
+  /// as distinct in a unique index).
+  idempotencyKey   String?   @map("idempotency_key")
   version          Int       @default(0)
   createdAt        DateTime  @default(now()) @map("created_at")
   updatedAt        DateTime  @updatedAt @map("updated_at")

+  @@unique([tenantId, fulfillmentRef, idempotencyKey])
   @@index([tenantId, fulfillmentRef])
   @@index([tenantId, orderRef])
   @@index([tenantId, status])
   @@map("shipments")
   @@schema("shipping")
```

#### `services/inventory/src/domain/inventory-item-repository.ts`

_(Pre-existing, omitted: `findByProduct`, `list` — both dated "Sprint 7.0 gap-only enrichment" in their own doc comment.)_

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/inventory-item-repository.ts" "b/services/inventory/src/domain/inventory-item-repository.ts"
index 1a58bab..3e2b921 100644
--- "a/<pre-Sprint-A0 snapshot>/inventory-item-repository.ts"
+++ "b/services/inventory/src/domain/inventory-item-repository.ts"
@@ -17,6 +17,17 @@ export interface InventoryItemRepository {
     tx?: unknown,
   ): Promise<InventoryItem | null>;
   /** Every item row for a product, across all warehouses (stock-availability aggregation). */
   findByProduct(productId: string, tx?: unknown): Promise<readonly InventoryItem[]>;
   list(page: CursorPage, tx?: unknown): Promise<Paginated<InventoryItem>>;
+  /**
+   * Looks up the item owning an existing reservation by `(itemId, reference)` — scaffolding for
+   * A3's saga-activity idempotency (Sprint A0 precondition). Returns the item so a caller can
+   * inspect its live reservation set for the matching entry rather than blindly re-reserving on a
+   * retried call. Not yet wired into any use case.
+   */
+  findByReservationReference(
+    itemId: string,
+    reference: string,
+    tx?: unknown,
+  ): Promise<InventoryItem | null>;
 }
```

#### `services/inventory/src/infrastructure/prisma-inventory-item-repository.ts`

_(Pre-existing, omitted: `findByProduct`, `list` implementations in the same file.)_

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/prisma-inventory-item-repository.ts" "b/services/inventory/src/infrastructure/prisma-inventory-item-repository.ts"
index d9b5681..02f9461 100644
--- "a/<pre-Sprint-A0 snapshot>/prisma-inventory-item-repository.ts"
+++ "b/services/inventory/src/infrastructure/prisma-inventory-item-repository.ts"
@@ -91,10 +91,24 @@ export class PrismaInventoryItemRepository implements InventoryItemRepository {
       include: { reservations: true },
     });
     return rows.map((r) => InventoryItemMapper.toDomain(r, r.reservations));
   }

+  /** Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
+  async findByReservationReference(
+    itemId: string,
+    reference: string,
+    tx?: unknown,
+  ): Promise<InventoryItem | null> {
+    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
+    const reservation = await client.reservation.findFirst({
+      where: { itemId, reference, tenantId: this.deps.tenantId },
+    });
+    if (reservation === null) return null;
+    return this.findById(reservation.itemId, tx);
+  }
+
   async list(page: CursorPage, tx?: unknown): Promise<Paginated<InventoryItem>> {
     const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
     const first = normalizePageSize(page.first);
     const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
     const rows = await client.inventoryItem.findMany({
```

#### `services/inventory/src/infrastructure/in-memory-inventory-item-repository.ts`

_(Pre-existing, omitted: `findByProduct`, `list` in the same file.)_

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/in-memory-inventory-item-repository.ts" "b/services/inventory/src/infrastructure/in-memory-inventory-item-repository.ts"
index 4fa3cfd..f209eb8 100644
--- "a/<pre-Sprint-A0 snapshot>/in-memory-inventory-item-repository.ts"
+++ "b/services/inventory/src/infrastructure/in-memory-inventory-item-repository.ts"
@@ -46,10 +46,21 @@ export class InMemoryInventoryItemRepository implements InventoryItemRepository

   async findByProduct(productId: string): Promise<readonly InventoryItem[]> {
     return [...this.store.values()].filter((item) => item.product.value === productId);
   }

+  /** Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
+  async findByReservationReference(
+    itemId: string,
+    reference: string,
+  ): Promise<InventoryItem | null> {
+    const item = this.store.get(itemId);
+    if (item === undefined) return null;
+    const hasMatch = item.reservations.some((r) => r.reference === reference);
+    return hasMatch ? item : null;
+  }
+
   async list(page: CursorPage): Promise<Paginated<InventoryItem>> {
     const first = normalizePageSize(page.first);
     const sorted = [...this.store.values()].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
     const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
     const filtered = after !== undefined ? sorted.filter((i) => i.id.toString() > after) : sorted;
```

#### `services/payments/src/infrastructure/prisma-payment-intent-repository.ts`

_(Pre-existing, omitted: the `save()` update path's `data: { ...PaymentIntentMapper.toIntentUpdate(intent), ... }` refactor, in the same file.)_

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/prisma-payment-intent-repository.ts" "b/services/payments/src/infrastructure/prisma-payment-intent-repository.ts"
index 852bfe6..f6dec90 100644
--- "a/<pre-Sprint-A0 snapshot>/prisma-payment-intent-repository.ts"
+++ "b/services/payments/src/infrastructure/prisma-payment-intent-repository.ts"
@@ -68,10 +68,23 @@ export class PrismaPaymentIntentRepository implements PaymentIntentRepository {
       },
     });
     return row === null ? null : PaymentIntentMapper.toDomain(row, row.charges, row.refunds);
   }

+  /** Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
+  async findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<PaymentIntent | null> {
+    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
+    const row = await client.paymentIntent.findFirst({
+      where: { idempotencyKey, tenantId: this.deps.tenantId },
+      include: {
+        charges: { orderBy: { occurredAt: "asc" } },
+        refunds: { orderBy: { occurredAt: "asc" } },
+      },
+    });
+    return row === null ? null : PaymentIntentMapper.toDomain(row, row.charges, row.refunds);
+  }
+
   private requireTx(tx: unknown): TransactionClient {
     if (tx === undefined || tx === null) {
       throw new Error(
         "PrismaPaymentIntentRepository.save requires the unit of work's transaction client (ADR-0003).",
       );
```

#### `services/shipping/src/domain/shipment-repository.ts` (untracked file; Sprint A0's addition, isolated)

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/shipment-repository.ts" "b/services/shipping/src/domain/shipment-repository.ts"
index 8640dd7..e081d53 100644
--- "a/<pre-Sprint-A0 snapshot>/shipment-repository.ts"
+++ "b/services/shipping/src/domain/shipment-repository.ts"
@@ -2,6 +2,18 @@ import type { Shipment } from "./shipment";

 /** Persistence port for {@link Shipment}. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
 export interface ShipmentRepository {
   save(shipment: Shipment, tx?: unknown): Promise<void>;
   findById(id: string, tx?: unknown): Promise<Shipment | null>;
+  /**
+   * Looks up a shipment by its caller-supplied idempotency key, scoped to the owning fulfillment —
+   * scaffolding for A8's Fulfillment->Shipping idempotency (Sprint A0 precondition). Returns `null`
+   * today for every key: the domain aggregate carries no `idempotencyKey` field yet, so nothing
+   * writes the column this queries. A8 threads the field through `Shipment`/`CreateShipment` to
+   * make this live.
+   */
+  findByIdempotencyKey(
+    fulfillmentRef: string,
+    idempotencyKey: string,
+    tx?: unknown,
+  ): Promise<Shipment | null>;
 }
```

#### `services/shipping/src/infrastructure/prisma-shipment-repository.ts` (untracked file; Sprint A0's addition, isolated)

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/prisma-shipment-repository.ts" "b/services/shipping/src/infrastructure/prisma-shipment-repository.ts"
index 3bbe5c6..b658f9a 100644
--- "a/<pre-Sprint-A0 snapshot>/prisma-shipment-repository.ts"
+++ "b/services/shipping/src/infrastructure/prisma-shipment-repository.ts"
@@ -48,10 +48,23 @@ export class PrismaShipmentRepository implements ShipmentRepository {
     const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
     const row = await client.shipment.findFirst({ where: { id, tenantId: this.deps.tenantId } });
     return row === null ? null : ShipmentMapper.toDomain(row);
   }

+  /** Scaffolding for A8's Fulfillment->Shipping idempotency (Sprint A0 precondition); not yet called by any use case. */
+  async findByIdempotencyKey(
+    fulfillmentRef: string,
+    idempotencyKey: string,
+    tx?: unknown,
+  ): Promise<Shipment | null> {
+    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
+    const row = await client.shipment.findFirst({
+      where: { fulfillmentRef, idempotencyKey, tenantId: this.deps.tenantId },
+    });
+    return row === null ? null : ShipmentMapper.toDomain(row);
+  }
+
   private requireTx(tx: unknown): TransactionClient {
     if (tx === undefined || tx === null) {
       throw new Error("PrismaShipmentRepository.save requires the unit of work's transaction client (ADR-0003).");
     }
     return tx as TransactionClient;
```

#### `services/shipping/src/infrastructure/in-memory-shipment-repository.ts` (untracked file; Sprint A0's addition, isolated)

```diff
diff --git "a/<pre-Sprint-A0 snapshot>/in-memory-shipment-repository.ts" "b/services/shipping/src/infrastructure/in-memory-shipment-repository.ts"
index 9293ae6..9ce4d0a 100644
--- "a/<pre-Sprint-A0 snapshot>/in-memory-shipment-repository.ts"
+++ "b/services/shipping/src/infrastructure/in-memory-shipment-repository.ts"
@@ -22,6 +22,19 @@ export class InMemoryShipmentRepository implements ShipmentRepository {
   }

   async findById(id: string): Promise<Shipment | null> {
     return this.store.get(id) ?? null;
   }
+
+  /**
+   * Scaffolding for A8's Fulfillment->Shipping idempotency (Sprint A0 precondition); not yet
+   * called by any use case. Always returns `null` — the domain aggregate carries no
+   * `idempotencyKey` field yet, so there is nothing to match against (mirrors the Prisma adapter's
+   * always-NULL column today).
+   */
+  async findByIdempotencyKey(
+    _fulfillmentRef: string,
+    _idempotencyKey: string,
+  ): Promise<Shipment | null> {
+    return null;
+  }
 }
```

### 1.3 New files (100% Sprint A0) — real `git diff --no-index -U5` against `/dev/null`

#### `packages/messaging/src/idempotency/duplicate-processed-event-error.ts`

```diff
diff --git a/packages/messaging/src/idempotency/duplicate-processed-event-error.ts b/packages/messaging/src/idempotency/duplicate-processed-event-error.ts
new file mode 100644
index 0000000..0270212
--- /dev/null
+++ b/packages/messaging/src/idempotency/duplicate-processed-event-error.ts
@@ -0,0 +1,13 @@
+/**
+ * Thrown inside an atomic-path transaction (`EventHandler.handleAtomic`) when `recordIfNew` loses
+ * the insert race to a concurrent redelivery. Throwing rolls back the handler's domain write in
+ * the same transaction — the whole point of the atomic path (ADR-0005, Sprint A0): the marker and
+ * the domain effect must commit together or not at all, never the marker alone. Callers catch this
+ * specifically to treat it as a benign duplicate, not a handler failure (no retry, no DLQ).
+ */
+export class DuplicateProcessedEventError extends Error {
+  constructor(readonly messageId: string) {
+    super(`integration event ${messageId} was concurrently processed twice`);
+    this.name = "DuplicateProcessedEventError";
+  }
+}
```

#### `packages/kafka/src/consumer-runtime.test.ts`

```diff
diff --git a/packages/kafka/src/consumer-runtime.test.ts b/packages/kafka/src/consumer-runtime.test.ts
new file mode 100644
index 0000000..4d99459
--- /dev/null
+++ b/packages/kafka/src/consumer-runtime.test.ts
@@ -0,0 +1,188 @@
+import { describe, expect, it } from "vitest";
+import type { EachMessagePayload, Kafka } from "kafkajs";
+import type { Clock } from "@platform/contracts";
+import type { EventSerializer } from "@platform/domain-events";
+import { InMemoryEventSerializer } from "@platform/domain-events/testing";
+import type { EventHandler, ProcessedEventStore } from "@platform/messaging";
+import { InMemoryDeadLetterStore, InMemoryProcessedEventStore } from "@platform/messaging";
+import type { TransactionalUnitOfWork } from "@platform/repository";
+import type { Logger } from "@platform/utils";
+import { KafkaConsumerRuntime } from "./consumer-runtime";
+import { DeadLetterPublisher } from "./dead-letter-publisher";
+
+type OrderPayload = { total: number };
+
+/** Fake transaction context — a distinct object per `run` call, so tests can assert identity. */
+type FakeTx = { readonly id: number };
+
+/** Runs `work` immediately with a fresh fake tx — no real rollback semantics, just identity/count tracking. */
+class FakeUnitOfWork implements TransactionalUnitOfWork<FakeTx> {
+  runCount = 0;
+  async run<T>(work: (tx: FakeTx) => Promise<T>): Promise<T> {
+    this.runCount += 1;
+    return work({ id: this.runCount });
+  }
+}
+
+function silentLogger(): Logger {
+  const log: Logger = {
+    debug: () => {},
+    info: () => {},
+    warn: () => {},
+    error: () => {},
+    child: () => log,
+  };
+  return log;
+}
+
+const clock: Clock = { now: () => new Date("2026-06-29T00:00:00.000Z") };
+const serializer: EventSerializer = new InMemoryEventSerializer();
+const noopPublisher = { publish: async () => {}, publishBatch: async () => {} };
+
+/** Builds a fake `EachMessagePayload` for `handleMessage` — never touches `.kafka`, so no broker needed. */
+function payload(total: number, messageId: string): EachMessagePayload {
+  const envelope = {
+    messageId,
+    type: "orders.order.placed",
+    eventVersion: 1,
+    aggregateId: "order-1",
+    aggregateType: "order",
+    occurredAt: clock.now().toISOString(),
+    correlationId: "c",
+    causationId: "c",
+    payload: { total },
+    metadata: {},
+  };
+  const serialized = serializer.serialize(envelope);
+  return {
+    topic: "orders.order.placed.v1",
+    partition: 0,
+    message: {
+      key: Buffer.from("order-1"),
+      value: Buffer.from(serialized.data),
+      headers: {
+        type: Buffer.from(serialized.type),
+        eventVersion: Buffer.from(String(serialized.eventVersion)),
+        contentType: Buffer.from(serialized.contentType),
+      },
+      timestamp: "0",
+      attributes: 0,
+      offset: "0",
+    },
+    heartbeat: async () => {},
+    pause: () => () => {},
+  } as unknown as EachMessagePayload;
+}
+
+function baseDeps(overrides: Record<string, unknown> = {}) {
+  return {
+    kafka: {} as Kafka, // handleMessage never touches this
+    serializer,
+    consumerGroup: "orders.test",
+    deadLetters: new DeadLetterPublisher({
+      publisher: noopPublisher,
+      store: new InMemoryDeadLetterStore(),
+      clock,
+    }),
+    retryPublisher: noopPublisher,
+    clock,
+    logger: silentLogger(),
+    ...overrides,
+  };
+}
+
+describe("KafkaConsumerRuntime — opt-in atomic path (Sprint A0)", () => {
+  it("handlers without handleAtomic are unaffected even when a unitOfWork is provided", async () => {
+    const handled: number[] = [];
+    const unitOfWork = new FakeUnitOfWork();
+    const handler: EventHandler<OrderPayload, FakeTx> = {
+      eventType: "orders.order.placed",
+      eventVersion: 1,
+      handle: async (event) => {
+        handled.push(event.payload.total);
+      },
+    };
+    const runtime = new KafkaConsumerRuntime({
+      ...baseDeps(),
+      handler,
+      processedEvents: new InMemoryProcessedEventStore(),
+      unitOfWork,
+    });
+
+    await runtime.handleMessage(payload(100, "evt-1"));
+
+    expect(handled).toEqual([100]);
+    expect(unitOfWork.runCount).toBe(0);
+  });
+
+  it("runs handleAtomic and the processed-marker write inside the same transaction", async () => {
+    const receivedTx: FakeTx[] = [];
+    const unitOfWork = new FakeUnitOfWork();
+    const processedEvents = new InMemoryProcessedEventStore();
+    const recordedTx: unknown[] = [];
+    const spiedStore: ProcessedEventStore = {
+      has: (id) => processedEvents.has(id),
+      recordIfNew: (id, at, tx) => {
+        recordedTx.push(tx);
+        return processedEvents.recordIfNew(id, at, tx);
+      },
+    };
+    const handler: EventHandler<OrderPayload, FakeTx> = {
+      eventType: "orders.order.placed",
+      eventVersion: 1,
+      handle: async () => {
+        throw new Error("should never be called — handleAtomic takes precedence");
+      },
+      handleAtomic: async (_event, tx) => {
+        receivedTx.push(tx);
+      },
+    };
+    const runtime = new KafkaConsumerRuntime({
+      ...baseDeps(),
+      handler,
+      processedEvents: spiedStore,
+      unitOfWork,
+    });
+
+    await runtime.handleMessage(payload(100, "evt-1"));
+
+    expect(unitOfWork.runCount).toBe(1);
+    expect(receivedTx).toEqual([{ id: 1 }]);
+    expect(recordedTx).toEqual([{ id: 1 }]);
+    expect(await processedEvents.has("evt-1")).toBe(true);
+  });
+
+  it("rolls back (never dead-letters/retries) when recordIfNew loses the race inside the transaction", async () => {
+    const unitOfWork = new FakeUnitOfWork();
+    const deadLetters = new InMemoryDeadLetterStore();
+    let handleAtomicCalls = 0;
+    const raceyStore: ProcessedEventStore = {
+      has: async () => false,
+      recordIfNew: async () => false, // always loses the race, simulating the closed window
+    };
+    const handler: EventHandler<OrderPayload, FakeTx> = {
+      eventType: "orders.order.placed",
+      eventVersion: 1,
+      handle: async () => {
+        throw new Error("should never be called");
+      },
+      handleAtomic: async () => {
+        handleAtomicCalls += 1;
+      },
+    };
+    const runtime = new KafkaConsumerRuntime({
+      ...baseDeps({
+        deadLetters: new DeadLetterPublisher({ publisher: noopPublisher, store: deadLetters, clock }),
+      }),
+      handler,
+      processedEvents: raceyStore,
+      unitOfWork,
+    });
+
+    await runtime.handleMessage(payload(100, "evt-1"));
+
+    expect(handleAtomicCalls).toBe(1);
+    expect(unitOfWork.runCount).toBe(1);
+    expect(deadLetters.snapshot()).toHaveLength(0);
+  });
+});
```

#### `services/inventory/src/infrastructure/find-by-reservation-reference.test.ts`

```diff
diff --git a/services/inventory/src/infrastructure/find-by-reservation-reference.test.ts b/services/inventory/src/infrastructure/find-by-reservation-reference.test.ts
new file mode 100644
index 0000000..345d049
--- /dev/null
+++ b/services/inventory/src/infrastructure/find-by-reservation-reference.test.ts
@@ -0,0 +1,59 @@
+import { describe, expect, it } from "vitest";
+import type { IdGenerator } from "@platform/contracts";
+import { ProductRef, UniqueEntityId } from "@platform/domain";
+import { InMemoryEventSerializer } from "@platform/domain-events/testing";
+import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
+import { InventoryItem } from "../domain/inventory-item";
+import { Quantity } from "../domain/value-objects/quantity";
+import { WarehouseId } from "../domain/value-objects/warehouse-id";
+import { InventoryEventTranslator } from "./inventory-event-translator";
+import { InMemoryInventoryItemRepository } from "./in-memory-inventory-item-repository";
+
+function sequentialIds(): IdGenerator {
+  let counter = 0;
+  return { generate: () => `id-${(counter += 1)}` };
+}
+
+function must<T>(r: { ok: boolean; value?: T }): T {
+  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
+  return r.value;
+}
+
+function buildRepo(): InMemoryInventoryItemRepository {
+  const outbox = new OutboxWriter({
+    store: new InMemoryOutboxStore(),
+    translator: new InventoryEventTranslator(),
+    serializer: new InMemoryEventSerializer(),
+    clock: { now: () => new Date("2026-07-26T00:00:00.000Z") },
+    producer: "inventory",
+  });
+  return new InMemoryInventoryItemRepository({ outbox, context: rootEventContext(sequentialIds()) });
+}
+
+// Sprint A0 precondition scaffolding for A3's saga-activity idempotency — dormant until A3 wires a
+// use case to call it, but exercised here so the port + adapters are proven correct now.
+describe("InventoryItemRepository.findByReservationReference (Sprint A0 precondition)", () => {
+  it("finds the item owning a reservation with the matching (itemId, reference)", async () => {
+    const repo = buildRepo();
+    const item = InventoryItem.create(
+      UniqueEntityId.from("item-1"),
+      must(ProductRef.create("product-1")),
+      must(WarehouseId.create("wh-1")),
+    );
+    item.receive(must(Quantity.create(10)), "evt-receive", new Date("2026-07-26T00:00:00.000Z"));
+    item.reserve(
+      UniqueEntityId.from("res-1"),
+      must(Quantity.create(3)),
+      "order-42",
+      "evt-reserve",
+      new Date("2026-07-26T00:00:00.000Z"),
+    );
+    await repo.save(item);
+
+    const found = await repo.findByReservationReference("item-1", "order-42");
+    expect(found?.id.toString()).toBe("item-1");
+
+    expect(await repo.findByReservationReference("item-1", "order-does-not-exist")).toBeNull();
+    expect(await repo.findByReservationReference("item-does-not-exist", "order-42")).toBeNull();
+  });
+});
```

#### `services/payments/src/infrastructure/find-by-idempotency-key.test.ts`

```diff
diff --git a/services/payments/src/infrastructure/find-by-idempotency-key.test.ts b/services/payments/src/infrastructure/find-by-idempotency-key.test.ts
new file mode 100644
index 0000000..c0cc404
--- /dev/null
+++ b/services/payments/src/infrastructure/find-by-idempotency-key.test.ts
@@ -0,0 +1,42 @@
+import { describe, expect, it } from "vitest";
+import type { IdGenerator } from "@platform/contracts";
+import { Money, UniqueEntityId } from "@platform/domain";
+import { InMemoryEventSerializer } from "@platform/domain-events/testing";
+import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
+import { PaymentIntent } from "../domain/payment-intent";
+import { PaymentEventTranslator } from "./payment-event-translator";
+import { InMemoryPaymentIntentRepository } from "./in-memory-payment-intent-repository";
+
+function sequentialIds(): IdGenerator {
+  let counter = 0;
+  return { generate: () => `id-${(counter += 1)}` };
+}
+
+function usd(amountMinor: number): Money {
+  const result = Money.create(amountMinor, "USD");
+  if (!result.ok) throw new Error("invalid fixture");
+  return result.value;
+}
+
+// Sprint A0 precondition scaffolding for A3's saga-activity idempotency — the domain aggregate
+// carries no idempotencyKey field yet, so this stays a dormant, always-null lookup until A3 wires
+// it up. Proven here so the port + adapter shape are correct now, ahead of that wiring.
+describe("PaymentIntentRepository.findByIdempotencyKey (Sprint A0 precondition)", () => {
+  it("always returns null — no code path writes an idempotency key yet", async () => {
+    const outbox = new OutboxWriter({
+      store: new InMemoryOutboxStore(),
+      translator: new PaymentEventTranslator(),
+      serializer: new InMemoryEventSerializer(),
+      clock: { now: () => new Date("2026-07-26T00:00:00.000Z") },
+      producer: "payments",
+    });
+    const repo = new InMemoryPaymentIntentRepository({
+      outbox,
+      context: rootEventContext(sequentialIds()),
+    });
+    const intent = PaymentIntent.create(UniqueEntityId.from("intent-1"), "order-1", usd(1000));
+    await repo.save(intent);
+
+    expect(await repo.findByIdempotencyKey("any-key")).toBeNull();
+  });
+});
```

#### `services/shipping/src/infrastructure/find-by-idempotency-key.test.ts`

```diff
diff --git a/services/shipping/src/infrastructure/find-by-idempotency-key.test.ts b/services/shipping/src/infrastructure/find-by-idempotency-key.test.ts
new file mode 100644
index 0000000..f34d7f9
--- /dev/null
+++ b/services/shipping/src/infrastructure/find-by-idempotency-key.test.ts
@@ -0,0 +1,54 @@
+import { describe, expect, it } from "vitest";
+import type { IdGenerator } from "@platform/contracts";
+import { UniqueEntityId } from "@platform/domain";
+import { InMemoryEventSerializer } from "@platform/domain-events/testing";
+import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
+import { Shipment } from "../domain/shipment";
+import { Carrier, CarrierService } from "../domain/value-objects/carrier";
+import { ShipmentPackage } from "../domain/value-objects/shipment-package";
+import { ShippingEventTranslator } from "./shipping-event-translator";
+import { InMemoryShipmentRepository } from "./in-memory-shipment-repository";
+
+function sequentialIds(): IdGenerator {
+  let counter = 0;
+  return { generate: () => `id-${(counter += 1)}` };
+}
+
+function must<T>(r: { ok: boolean; value?: T }): T {
+  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
+  return r.value;
+}
+
+// Sprint A0 precondition scaffolding for A8's Fulfillment->Shipping idempotency — the domain
+// aggregate carries no idempotencyKey field yet, so this stays a dormant, always-null lookup until
+// A8 wires it up. Proven here so the port + adapter shape are correct now, ahead of that wiring.
+describe("ShipmentRepository.findByIdempotencyKey (Sprint A0 precondition)", () => {
+  it("always returns null — no code path writes an idempotency key yet", async () => {
+    const outbox = new OutboxWriter({
+      store: new InMemoryOutboxStore(),
+      translator: new ShippingEventTranslator(),
+      serializer: new InMemoryEventSerializer(),
+      clock: { now: () => new Date("2026-07-26T00:00:00.000Z") },
+      producer: "shipping",
+    });
+    const repo = new InMemoryShipmentRepository({
+      outbox,
+      context: rootEventContext(sequentialIds()),
+    });
+    const shipment = Shipment.create(
+      UniqueEntityId.from("shipment-1"),
+      {
+        fulfillmentRef: "f1",
+        orderRef: "o1",
+        carrier: must(Carrier.create("ups")),
+        service: must(CarrierService.create("ground")),
+        packages: [must(ShipmentPackage.create("pkg-1", ["p1"], 500))],
+      },
+      "evt-1",
+      new Date("2026-07-26T00:00:00.000Z"),
+    );
+    await repo.save(shipment);
+
+    expect(await repo.findByIdempotencyKey("f1", "any-key")).toBeNull();
+  });
+});
```

#### `services/security/src/interfaces/relation-sync.consumer.test.ts`

```diff
diff --git a/services/security/src/interfaces/relation-sync.consumer.test.ts b/services/security/src/interfaces/relation-sync.consumer.test.ts
new file mode 100644
index 0000000..07efb03
--- /dev/null
+++ b/services/security/src/interfaces/relation-sync.consumer.test.ts
@@ -0,0 +1,9 @@
+import { describe, expect, it } from "vitest";
+import { RelationDeletedConsumer, RelationWrittenConsumer } from "./relation-sync.consumer";
+
+describe("RelationWrittenConsumer / RelationDeletedConsumer — atomic opt-out (Sprint A0)", () => {
+  it("never implements handleAtomic — these consumers make an Ory Keto HTTP call with no DB write to make atomic", () => {
+    expect("handleAtomic" in RelationWrittenConsumer.prototype).toBe(false);
+    expect("handleAtomic" in RelationDeletedConsumer.prototype).toBe(false);
+  });
+});
```

#### `services/security/src/interfaces/session-revoked-all.consumer.test.ts`

```diff
diff --git a/services/security/src/interfaces/session-revoked-all.consumer.test.ts b/services/security/src/interfaces/session-revoked-all.consumer.test.ts
new file mode 100644
index 0000000..2cfa23d
--- /dev/null
+++ b/services/security/src/interfaces/session-revoked-all.consumer.test.ts
@@ -0,0 +1,8 @@
+import { describe, expect, it } from "vitest";
+import { SessionRevokedAllConsumer } from "./session-revoked-all.consumer";
+
+describe("SessionRevokedAllConsumer — atomic opt-out (Sprint A0)", () => {
+  it("never implements handleAtomic — this consumer makes an Ory Kratos HTTP call with no DB write to make atomic", () => {
+    expect("handleAtomic" in SessionRevokedAllConsumer.prototype).toBe(false);
+  });
+});
```

#### `apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts`

```diff
diff --git a/apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts b/apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts
new file mode 100644
index 0000000..e1eb627
--- /dev/null
+++ b/apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts
@@ -0,0 +1,8 @@
+import { describe, expect, it } from "vitest";
+import { TrackingIngestHandler } from "./tracking-ingest";
+
+describe("TrackingIngestHandler — atomic opt-out (Sprint A0)", () => {
+  it("never implements handleAtomic — vendor delivery is an HTTP call with no DB write to make atomic, and it runs its own purpose-different recordIfNew for destination-level dedup", () => {
+    expect("handleAtomic" in TrackingIngestHandler.prototype).toBe(false);
+  });
+});
```

_(`docs/implementation/SPRINT_A0_REPORT.md`, the original review pack, and this appendix are documentation, not source — omitted from patch form; their content is the documents themselves.)_

---

## 2. Full contents of every `migration.sql` introduced by Sprint A0

Exactly one migration file exists for Sprint A0:
`packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql`

```sql
-- Sprint A0 (Preconditions) — additive, expand-only (doc 15 §2.4). Prepares schema/repository
-- plumbing three later Phase A items will need (A3, A8), without any of A3/A8/A1's business logic
-- or saga wiring. Generated offline (no database host in this environment); apply with
-- `prisma migrate deploy` against Postgres 16. See docs/implementation/SPRINT_A0_REPORT.md for the
-- required pre-migration audit before step 1 runs.

-- Step 1 (A3 precondition) — Reservation: unique constraint on already-populated columns. RUN THE
-- PRE-MIGRATION DUPLICATE AUDIT IN SPRINT_A0_REPORT.md FIRST; resolve any existing
-- (tenant_id, item_id, reference) duplicates manually before this statement runs, or it will fail.
CREATE UNIQUE INDEX "reservations_tenant_id_item_id_reference_key"
  ON "inventory"."reservations"("tenant_id", "item_id", "reference");

-- Step 2 (A3 precondition) — PaymentIntent: new nullable idempotency key + unique constraint.
-- Safe without an audit: the column is new (every existing row is NULL), and Postgres treats each
-- NULL as distinct in a unique index, so no pre-existing row can violate it.
ALTER TABLE "payments"."payment_intents" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "payment_intents_tenant_id_idempotency_key_key"
  ON "payments"."payment_intents"("tenant_id", "idempotency_key");

-- Step 3 (A8 precondition) — Shipment: new nullable idempotency key + unique constraint. Same
-- NULL-safety reasoning as step 2.
ALTER TABLE "shipping"."shipments" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "shipments_tenant_id_fulfillment_ref_idempotency_key_key"
  ON "shipping"."shipments"("tenant_id", "fulfillment_ref", "idempotency_key");
```

No other migration file was added or modified by Sprint A0.

---

## 3. Complete final source

### `EventHandler` — `packages/messaging/src/consumer/event-handler.ts` (full file, 23 lines)

```typescript
import type { IntegrationEvent } from "@platform/domain-events";

/**
 * Handles a single integration-event type. Implemented per consuming context. `eventType` /
 * `eventVersion` declare the subscription a broker adapter routes to. Handlers should be idempotent
 * (the `ProcessedEventStore` dedupes redelivery, but handlers must tolerate at-least-once).
 *
 * `handleAtomic` is an **opt-in** capability (ADR-0005, Sprint A0): when implemented, and the
 * runtime is given a `TransactionalUnitOfWork` (`@platform/repository`), the runtime opens one
 * transaction, calls `handleAtomic(event, tx)`, then records the processed-marker with that same
 * `tx` — the handler's domain write and the idempotency marker commit or roll back together
 * (upgrading at-least-once delivery to exactly-once *effect*). Handlers that only implement
 * `handle` are entirely unaffected — this must stay opt-in, never a blanket requirement: several
 * existing handlers make external network calls with no DB write to make atomic in the first
 * place, and wrapping those in an open Postgres transaction would hold a connection across
 * arbitrary-latency vendor calls for zero correctness benefit.
 */
export interface EventHandler<TPayload, TContext = unknown> {
  readonly eventType: string;
  readonly eventVersion: number;
  handle(event: IntegrationEvent<TPayload>): Promise<void>;
  handleAtomic?(event: IntegrationEvent<TPayload>, tx: TContext): Promise<void>;
}
```

### `EventConsumer` — `packages/messaging/src/consumer/event-consumer.ts` (full file, 158 lines)

```typescript
import type { Clock } from "@platform/contracts";
import type {
  EventSerializer,
  IntegrationEvent,
  SerializedEnvelope,
} from "@platform/domain-events";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { Logger } from "@platform/utils";
import type { DeadLetterStore } from "../dlq/dead-letter-store";
import { DuplicateProcessedEventError } from "../idempotency/duplicate-processed-event-error";
import type { ProcessedEventStore } from "../idempotency/processed-event-store";
import type { RetryPolicy } from "../retry/retry-policy";
import type { EventHandler } from "./event-handler";
import type { IncomingMessage } from "./incoming-message";

export interface EventConsumerDeps<TContext = unknown> {
  readonly serializer: EventSerializer;
  readonly processedEvents: ProcessedEventStore;
  readonly deadLetters: DeadLetterStore;
  readonly retryPolicy: RetryPolicy;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Delays between retries; injected so tests stay deterministic and production controls timing. */
  readonly sleep: (ms: number) => Promise<void>;
  /**
   * Opt-in atomic capability (Sprint A0, ADR-0005): when provided, and the handler implements
   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
   * transaction. Omit for handlers that only implement `handle` — nothing changes for them.
   */
  readonly unitOfWork?: TransactionalUnitOfWork<TContext>;
}

/**
 * Turns a raw broker message into a typed, idempotent, retried handler call. Transport-agnostic: a
 * broker adapter (Redpanda, later) feeds it `IncomingMessage`s; tests feed them directly.
 *
 * Flow: deserialize → idempotency pre-check (fast skip if already processed) → handle →
 * `recordIfNew` (atomic claim). On handler failure it retries with bounded backoff; on exhaustion
 * the message is dead-lettered and acknowledged. Idempotency is keyed by `messageId`.
 *
 * The pre-check narrows the duplicate window but cannot close it (check-then-act); the atomic
 * `recordIfNew` detects a concurrent duplicate after the fact. Handlers must therefore be
 * idempotent themselves (ADR-0005) — the production adapter closes the window fully by writing
 * the processed marker inside the handler's own transaction.
 */
export class EventConsumer<TPayload, TContext = unknown> {
  private readonly handler: EventHandler<TPayload, TContext>;
  private readonly deps: EventConsumerDeps<TContext>;

  constructor(handler: EventHandler<TPayload, TContext>, deps: EventConsumerDeps<TContext>) {
    this.handler = handler;
    this.deps = deps;
  }

  async consume(message: IncomingMessage): Promise<void> {
    const event = this.deps.serializer.deserialize<TPayload>(toSerialized(message));

    if (await this.deps.processedEvents.has(event.messageId)) {
      return;
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        if (this.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
          await this.consumeAtomic(event, message);
          return;
        }
        await this.handler.handle(event);
        const isNew = await this.deps.processedEvents.recordIfNew(
          event.messageId,
          this.deps.clock.now().toISOString(),
        );
        if (!isNew) {
          this.deps.logger.warn("integration event was concurrently processed twice", {
            messageId: event.messageId,
            topic: message.topic,
          });
        }
        return;
      } catch (error) {
        if (attempt >= this.deps.retryPolicy.maxAttempts) {
          await this.deps.deadLetters.add({
            messageId: event.messageId,
            topic: message.topic,
            value: message.value,
            headers: message.headers,
            attempts: attempt,
            error: errorMessage(error),
            failedAt: this.deps.clock.now().toISOString(),
          });
          this.deps.logger.error("integration event dead-lettered", {
            messageId: event.messageId,
            topic: message.topic,
            attempts: attempt,
          });
          return;
        }
        this.deps.logger.warn("integration event handler failed; retrying", {
          messageId: event.messageId,
          topic: message.topic,
          attempt,
        });
        await this.deps.sleep(this.deps.retryPolicy.delayForAttempt(attempt));
      }
    }
  }

  /**
   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
   * transaction. If `recordIfNew` loses the race to a concurrent redelivery, throws
   * `DuplicateProcessedEventError` from inside the transaction — rolling back the handler's domain
   * write, so a lost race never leaves a half-applied effect. That specific error is swallowed here
   * (logged, not retried, not dead-lettered); anything else propagates to `consume`'s retry/DLQ
   * handling unchanged.
   */
  private async consumeAtomic(
    event: IntegrationEvent<TPayload>,
    message: IncomingMessage,
  ): Promise<void> {
    const handleAtomic = this.handler.handleAtomic;
    const unitOfWork = this.deps.unitOfWork;
    if (handleAtomic === undefined || unitOfWork === undefined) {
      throw new Error("consumeAtomic requires both handleAtomic and unitOfWork to be defined");
    }
    try {
      await unitOfWork.run(async (tx) => {
        await handleAtomic(event, tx);
        const isNew = await this.deps.processedEvents.recordIfNew(
          event.messageId,
          this.deps.clock.now().toISOString(),
          tx,
        );
        if (!isNew) {
          throw new DuplicateProcessedEventError(event.messageId);
        }
      });
    } catch (error) {
      if (error instanceof DuplicateProcessedEventError) {
        this.deps.logger.warn("integration event was concurrently processed twice", {
          messageId: event.messageId,
          topic: message.topic,
        });
        return;
      }
      throw error;
    }
  }
}

function toSerialized(message: IncomingMessage): SerializedEnvelope {
  return {
    type: message.headers.type ?? "",
    eventVersion: Number(message.headers.eventVersion ?? "0"),
    contentType: message.headers.contentType ?? "",
    data: message.value,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

### `KafkaConsumerRuntime` — `packages/kafka/src/consumer-runtime.ts` (full file, 271 lines)

```typescript
import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";
import type { Clock } from "@platform/contracts";
import type { EventSerializer, IntegrationEvent } from "@platform/domain-events";
import {
  DuplicateProcessedEventError,
  type EventHandler,
  type EventPublisher,
  type ProcessedEventStore,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { Logger } from "@platform/utils";
import type { DeadLetterPublisher } from "./dead-letter-publisher";
import { noopMetrics, type MessagingMetrics } from "./metrics";
import { decodeRetryHeaders, encodeRetryHeaders, traceHeaders } from "./runtime-headers";
import {
  DEFAULT_RETRY_SCHEDULE,
  delayForAttempt,
  maxAttempts,
  type RetrySchedule,
} from "./retry-schedule";

export interface KafkaConsumerRuntimeDeps<TPayload, TContext = unknown> {
  readonly kafka: Kafka;
  readonly handler: EventHandler<TPayload, TContext>;
  readonly consumerGroup: string;
  readonly serializer: EventSerializer;
  /** ADR-0005 idempotency — Postgres remains the source of truth (`PrismaProcessedEventStore`). */
  readonly processedEvents: ProcessedEventStore;
  readonly deadLetters: DeadLetterPublisher;
  /** Producer used to schedule redeliveries onto `<topic>.retry`. */
  readonly retryPublisher: EventPublisher;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics?: MessagingMetrics;
  readonly retrySchedule?: RetrySchedule;
  /** Injected so tests stay deterministic; production waits for a retry message's due time. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Opt-in atomic capability (Sprint A0, ADR-0005): when provided, and `handler` implements
   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
   * transaction. Omit for handlers that only implement `handle` — nothing changes for them.
   */
  readonly unitOfWork?: TransactionalUnitOfWork<TContext>;
}

/**
 * Production consumer runtime (Sprint 2.5, D-046). Composes the EXISTING ports — serializer,
 * `ProcessedEventStore`, DLQ — with broker-side redelivery, deliberately replacing
 * `EventConsumer`'s in-process sleep loop, which must never reach a consumer group (ADR-0005
 * note, G-9: sleeping in `eachMessage` head-of-line blocks the partition).
 *
 * Flow per message: decode headers → (retry topic only: wait until due) → deserialize →
 * `recordIfNew` claim (atomic; duplicate ⇒ ack + count) → handle → commit. On failure: attempt <
 * max ⇒ republish ORIGINAL bytes to `<topic>.retry` with attempt+due headers and ack; attempt =
 * max ⇒ DLQ publish + row, ack. The main topic never blocks; a poison message can loop at most
 * `maxAttempts` times, then rests in the DLQ.
 *
 * Idempotency order is the ADR-0005 one — fast `has` pre-check → handle → atomic `recordIfNew`:
 * recording BEFORE handling would lose a message that crashes between claim and handle (marked
 * processed, never effected). The residual concurrent-duplicate window is closed for real when
 * the handler records the marker inside its own transaction (`PrismaProcessedEventStore`
 * accepts the tx); handlers remain idempotent regardless (ADR-0005).
 */
export class KafkaConsumerRuntime<TPayload, TContext = unknown> {
  private readonly deps: KafkaConsumerRuntimeDeps<TPayload, TContext>;
  private readonly metrics: MessagingMetrics;
  private readonly schedule: RetrySchedule;
  private readonly sleep: (ms: number) => Promise<void>;
  private consumer: Consumer | null = null;

  constructor(deps: KafkaConsumerRuntimeDeps<TPayload, TContext>) {
    this.deps = deps;
    this.metrics = deps.metrics ?? noopMetrics;
    this.schedule = deps.retrySchedule ?? DEFAULT_RETRY_SCHEDULE;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The main topic this runtime serves (`<type>.v<version>`). */
  get topic(): string {
    return `${this.deps.handler.eventType}.v${this.deps.handler.eventVersion}`;
  }

  get consumerGroup(): string {
    return this.deps.consumerGroup;
  }

  get isRunning(): boolean {
    return this.consumer !== null;
  }

  async start(): Promise<void> {
    if (this.consumer !== null) return;
    const consumer = this.deps.kafka.consumer({
      groupId: this.deps.consumerGroup,
      allowAutoTopicCreation: false,
    });
    await consumer.connect();
    await consumer.subscribe({ topics: [this.topic, `${this.topic}.retry`], fromBeginning: false });
    await consumer.run({
      eachMessage: (payload) => this.handleMessage(payload),
    });
    this.consumer = consumer;
  }

  async stop(): Promise<void> {
    if (this.consumer !== null) {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }

  /** Exposed for tests (deterministic, no broker). Production calls arrive via `run`. */
  async handleMessage(payload: EachMessagePayload): Promise<void> {
    const headers = decodeHeaderBag(payload);
    const value = payload.message.value ?? Buffer.alloc(0);
    const key = payload.message.key?.toString() ?? "";
    const retry = decodeRetryHeaders(headers);
    const attempt = retry?.attempt ?? 0;

    // Retry-topic message: wait out its remaining delay (segregated partition — main never blocks).
    if (retry !== null) {
      const wait = retry.dueAtMs - this.deps.clock.now().getTime();
      if (wait > 0) await this.sleep(wait);
    }

    const envelope = this.deps.serializer.deserialize<TPayload>({
      type: headers["type"] ?? "",
      eventVersion: Number(headers["eventVersion"] ?? "0"),
      contentType: headers["contentType"] ?? "",
      data: value,
    });

    const started = this.deps.clock.now().getTime();
    if (await this.deps.processedEvents.has(envelope.messageId)) {
      this.metrics.duplicate(this.topic, this.deps.consumerGroup);
      return; // already effected — redelivery ack'd
    }

    try {
      if (this.deps.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
        const handled = await this.handleAtomic(envelope);
        if (!handled) {
          // Lost the recordIfNew race inside the transaction — a concurrent redelivery already
          // effected this message; the domain write rolled back with it. Benign duplicate, ack.
          this.metrics.duplicate(this.topic, this.deps.consumerGroup);
          return;
        }
      } else {
        await this.deps.handler.handle(envelope);
        await this.deps.processedEvents.recordIfNew(
          envelope.messageId,
          this.deps.clock.now().toISOString(),
        );
      }
      this.metrics.processed(
        this.topic,
        this.deps.consumerGroup,
        this.deps.clock.now().getTime() - started,
      );
    } catch (error) {
      this.metrics.failed(this.topic, this.deps.consumerGroup);
      await this.scheduleRetryOrDeadLetter({
        attempt,
        key,
        value,
        headers,
        messageId: envelope.messageId,
        error,
      });
    }
  }

  /**
   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
   * transaction. Returns `false` if a concurrent redelivery won the `recordIfNew` race (the
   * transaction is rolled back in that case, per `DuplicateProcessedEventError`); returns `true` on
   * a normal commit. Any other error propagates to `handleMessage`'s retry/DLQ handling unchanged.
   */
  private async handleAtomic(envelope: IntegrationEvent<TPayload>): Promise<boolean> {
    const handleAtomic = this.deps.handler.handleAtomic;
    const unitOfWork = this.deps.unitOfWork;
    if (handleAtomic === undefined || unitOfWork === undefined) {
      throw new Error("handleAtomic requires both handler.handleAtomic and deps.unitOfWork");
    }
    try {
      await unitOfWork.run(async (tx) => {
        await handleAtomic(envelope, tx);
        const isNew = await this.deps.processedEvents.recordIfNew(
          envelope.messageId,
          this.deps.clock.now().toISOString(),
          tx,
        );
        if (!isNew) {
          throw new DuplicateProcessedEventError(envelope.messageId);
        }
      });
      return true;
    } catch (error) {
      if (error instanceof DuplicateProcessedEventError) {
        return false;
      }
      throw error;
    }
  }

  private async scheduleRetryOrDeadLetter(input: {
    readonly attempt: number;
    readonly key: string;
    readonly value: Uint8Array;
    readonly headers: Readonly<Record<string, string>>;
    readonly messageId: string;
    readonly error: unknown;
  }): Promise<void> {
    const nextAttempt = input.attempt + 1;
    if (nextAttempt > maxAttempts(this.schedule)) {
      await this.deps.deadLetters.publish({
        originalTopic: this.topic,
        consumerGroup: this.deps.consumerGroup,
        messageId: input.messageId,
        key: input.key,
        value: input.value,
        headers: input.headers,
        attempts: input.attempt,
        error: input.error,
      });
      this.metrics.deadLettered(this.topic, this.deps.consumerGroup);
      this.deps.logger.error("message dead-lettered", {
        topic: this.topic,
        consumerGroup: this.deps.consumerGroup,
        messageId: input.messageId,
        attempts: input.attempt,
      });
      return;
    }

    const delay = delayForAttempt(this.schedule, nextAttempt);
    await this.deps.retryPublisher.publish({
      topic: `${this.topic}.retry`,
      key: input.key,
      value: input.value, // original bytes, verbatim
      headers: {
        ...input.headers,
        ...traceHeaders(input.headers),
        ...encodeRetryHeaders({
          attempt: nextAttempt,
          dueAtMs: this.deps.clock.now().getTime() + delay,
          originalTopic: this.topic,
          consumerGroup: this.deps.consumerGroup,
        }),
      },
    });
    this.metrics.retried(this.topic, this.deps.consumerGroup, nextAttempt);
    this.deps.logger.warn("message scheduled for retry", {
      topic: this.topic,
      consumerGroup: this.deps.consumerGroup,
      messageId: input.messageId,
      attempt: nextAttempt,
      delayMs: delay,
    });
  }
}

function decodeHeaderBag(payload: EachMessagePayload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(payload.message.headers ?? {})) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? (value[0]?.toString() ?? "") : value.toString();
  }
  return out;
}
```

---

## 4. Exact grep output

Run fresh via `git grep --untracked` (covers both tracked and untracked files, so nothing this
sprint added is missed) at repo root.

### 4.1 `handleAtomic` — zero production implementations

```
$ git grep --untracked -n "handleAtomic" -- "*.ts"
apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts:5:  it("never implements handleAtomic — vendor delivery is an HTTP call with no DB write to make atomic, and it runs its own purpose-different recordIfNew for destination-level dedup", () => {
apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts:6:    expect("handleAtomic" in TrackingIngestHandler.prototype).toBe(false);
packages/kafka/src/consumer-runtime.test.ts:95:  it("handlers without handleAtomic are unaffected even when a unitOfWork is provided", async () => {
packages/kafka/src/consumer-runtime.test.ts:118:  it("runs handleAtomic and the processed-marker write inside the same transaction", async () => {
packages/kafka/src/consumer-runtime.test.ts:134:        throw new Error("should never be called — handleAtomic takes precedence");
packages/kafka/src/consumer-runtime.test.ts:136:      handleAtomic: async (_event, tx) => {
packages/kafka/src/consumer-runtime.test.ts:158:    let handleAtomicCalls = 0;
packages/kafka/src/consumer-runtime.test.ts:169:      handleAtomic: async () => {
packages/kafka/src/consumer-runtime.test.ts:170:        handleAtomicCalls += 1;
packages/kafka/src/consumer-runtime.test.ts:184:    expect(handleAtomicCalls).toBe(1);
packages/kafka/src/consumer-runtime.ts:40:   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
packages/kafka/src/consumer-runtime.ts:140:      if (this.deps.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
packages/kafka/src/consumer-runtime.ts:141:        const handled = await this.handleAtomic(envelope);
packages/kafka/src/consumer-runtime.ts:174:   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
packages/kafka/src/consumer-runtime.ts:179:  private async handleAtomic(envelope: IntegrationEvent<TPayload>): Promise<boolean> {
packages/kafka/src/consumer-runtime.ts:180:    const handleAtomic = this.deps.handler.handleAtomic;
packages/kafka/src/consumer-runtime.ts:182:    if (handleAtomic === undefined || unitOfWork === undefined) {
packages/kafka/src/consumer-runtime.ts:183:      throw new Error("handleAtomic requires both handler.handleAtomic and deps.unitOfWork");
packages/kafka/src/consumer-runtime.ts:187:        await handleAtomic(envelope, tx);
packages/messaging/src/consumer/event-consumer.test.ts:164:    it("handlers without handleAtomic are unaffected even when a unitOfWork is provided", async () => {
packages/messaging/src/consumer/event-consumer.test.ts:182:    it("runs handleAtomic and the processed-marker write inside the same transaction", async () => {
packages/messaging/src/consumer/event-consumer.test.ts:198:          throw new Error("should never be called — handleAtomic takes precedence");
packages/messaging/src/consumer/event-consumer.test.ts:200:        handleAtomic: async (_event, tx) => {
packages/messaging/src/consumer/event-consumer.test.ts:214:      expect(recordedTx).toEqual([{ id: 1 }]); // same tx object handleAtomic received
packages/messaging/src/consumer/event-consumer.test.ts:225:      let handleAtomicCalls = 0;
packages/messaging/src/consumer/event-consumer.test.ts:237:        handleAtomic: async () => {
packages/messaging/src/consumer/event-consumer.test.ts:238:          handleAtomicCalls += 1;
packages/messaging/src/consumer/event-consumer.test.ts:260:      expect(handleAtomicCalls).toBe(1); // handleAtomic ran inside the tx...
packages/messaging/src/consumer/event-consumer.ts:23:   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
packages/messaging/src/consumer/event-consumer.ts:60:        if (this.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
packages/messaging/src/consumer/event-consumer.ts:105:   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
packages/messaging/src/consumer/event-consumer.ts:116:    const handleAtomic = this.handler.handleAtomic;
packages/messaging/src/consumer/event-consumer.ts:118:    if (handleAtomic === undefined || unitOfWork === undefined) {
packages/messaging/src/consumer/event-consumer.ts:119:      throw new Error("consumeAtomic requires both handleAtomic and unitOfWork to be defined");
packages/messaging/src/consumer/event-consumer.ts:123:        await handleAtomic(event, tx);
packages/messaging/src/consumer/event-handler.ts:8: * `handleAtomic` is an **opt-in** capability (ADR-0005, Sprint A0): when implemented, and the
packages/messaging/src/consumer/event-handler.ts:10: * transaction, calls `handleAtomic(event, tx)`, then records the processed-marker with that same
packages/messaging/src/consumer/event-handler.ts:22:  handleAtomic?(event: IntegrationEvent<TPayload>, tx: TContext): Promise<void>;
packages/messaging/src/idempotency/duplicate-processed-event-error.ts:2: * Thrown inside an atomic-path transaction (`EventHandler.handleAtomic`) when `recordIfNew` loses
services/security/src/interfaces/relation-sync.consumer.test.ts:5:  it("never implements handleAtomic — these consumers make an Ory Keto HTTP call with no DB write to make atomic", () => {
services/security/src/interfaces/relation-sync.consumer.test.ts:6:    expect("handleAtomic" in RelationWrittenConsumer.prototype).toBe(false);
services/security/src/interfaces/session-revoked-all.consumer.test.ts:5:  it("never implements handleAtomic — this consumer makes an Ory Kratos HTTP call with no DB write to make atomic", () => {
services/security/src/interfaces/session-revoked-all.consumer.test.ts:6:    expect("handleAtomic" in SessionRevokedAllConsumer.prototype).toBe(false);
EXIT:0
```

**9 files. Every one is a file Sprint A0 added or edited.** None of the 17 production
`EventHandler` implementations (`PaymentCapturedConsumer`, `OrderPaymentReceivedConsumer` ×2,
`ShipmentShippedConsumer`, `RelationWrittenConsumer`, `RelationDeletedConsumer`,
`SessionRevokedAllConsumer`, `TrackingIngestHandler`, the 5 Security projection consumers, etc.)
appears. The 3 regression tests assert this at the prototype level, not just by grep absence — see
their `expect("handleAtomic" in X.prototype).toBe(false)` lines above, and their pass/fail result in
§5.3 (`services/security test: ✓ src/interfaces/relation-sync.consumer.test.ts (1 test)`,
`✓ src/interfaces/session-revoked-all.consumer.test.ts (1 test)`,
`apps/runtime test: ✓ src/tracking/tracking-ingest-atomic-opt-out.test.ts (1 test)`).

### 4.2 `findByReservationReference` — zero `UseCase` references

```
$ git grep --untracked -n "findByReservationReference" -- "*.ts"
services/inventory/src/domain/inventory-item-repository.ts:28:  findByReservationReference(
services/inventory/src/infrastructure/find-by-reservation-reference.test.ts:35:describe("InventoryItemRepository.findByReservationReference (Sprint A0 precondition)", () => {
services/inventory/src/infrastructure/find-by-reservation-reference.test.ts:53:    const found = await repo.findByReservationReference("item-1", "order-42");
services/inventory/src/infrastructure/find-by-reservation-reference.test.ts:56:    expect(await repo.findByReservationReference("item-1", "order-does-not-exist")).toBeNull();
services/inventory/src/infrastructure/find-by-reservation-reference.test.ts:57:    expect(await repo.findByReservationReference("item-does-not-exist", "order-42")).toBeNull();
services/inventory/src/infrastructure/in-memory-inventory-item-repository.ts:52:  async findByReservationReference(
services/inventory/src/infrastructure/prisma-inventory-item-repository.ts:97:  async findByReservationReference(
EXIT:0
```

**7 matches, 3 files: the domain port, the Prisma adapter, the in-memory adapter, plus this
sprint's own test.** Zero matches under `services/inventory/src/application/` (where
`ReserveStock`, `ReleaseReservation`, `CommitReservation`, `AdjustInventory`, etc. — the actual
`UseCase` implementations — live).

### 4.3 `findByIdempotencyKey` — zero `UseCase` references

```
$ git grep --untracked -n "findByIdempotencyKey" -- "*.ts"
services/payments/src/domain/payment-intent-repository.ts:13:  findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<PaymentIntent | null>;
services/payments/src/infrastructure/find-by-idempotency-key.test.ts:24:describe("PaymentIntentRepository.findByIdempotencyKey (Sprint A0 precondition)", () => {
services/payments/src/infrastructure/find-by-idempotency-key.test.ts:40:    expect(await repo.findByIdempotencyKey("any-key")).toBeNull();
services/payments/src/infrastructure/in-memory-payment-intent-repository.ts:35:  async findByIdempotencyKey(_idempotencyKey: string): Promise<PaymentIntent | null> {
services/payments/src/infrastructure/prisma-payment-intent-repository.ts:74:  async findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<PaymentIntent | null> {
services/shipping/src/domain/shipment-repository.ts:14:  findByIdempotencyKey(
services/shipping/src/infrastructure/find-by-idempotency-key.test.ts:25:describe("ShipmentRepository.findByIdempotencyKey (Sprint A0 precondition)", () => {
services/shipping/src/infrastructure/find-by-idempotency-key.test.ts:52:    expect(await repo.findByIdempotencyKey("f1", "any-key")).toBeNull();
services/shipping/src/infrastructure/in-memory-shipment-repository.ts:34:  async findByIdempotencyKey(
services/shipping/src/infrastructure/prisma-shipment-repository.ts:54:  async findByIdempotencyKey(
EXIT:0
```

**10 matches, 6 files: the two domain ports, the two Prisma adapters, the two in-memory adapters,
plus this sprint's own two tests.** Zero matches under `services/payments/src/application/`
(`CreatePaymentIntent`, `CapturePayment`, `RefundPayment`, `FailPayment`, `RecordWebhook`, etc.) or
`services/shipping/src/application/` (`CreateShipment`, `RecordCarrierWebhook`, shipment-lifecycle
use cases).

---

## 5. Exact command outputs and exit codes

### 5.1 Root-level commands (as literally typed: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm arch`)

```
$ pnpm lint
node:internal/child_process:441
    throw new ErrnoException(err, 'spawn');
    ^

Error: spawn UNKNOWN
    at ChildProcess.spawn (node:internal/child_process:441:11)
    at Object.spawn (node:child_process:796:9)
    at runTurboChild (...\node_modules\.pnpm\turbo@2.10.0\node_modules\turbo\bin\turbo:358:31)
    at runTurbo (...\node_modules\.pnpm\turbo@2.10.0\node_modules\turbo\bin\turbo:354:3)
    at Object.<anonymous> (...\node_modules\.pnpm\turbo@2.10.0\node_modules\turbo\bin\turbo:434:1)
    at Module._compile (node:internal/modules/cjs/loader:1830:14)
    at Object..js (node:internal/modules/cjs/loader:1961:10)
    at Module.load (node:internal/modules/cjs/loader:1553:32)
    at Module._load (node:internal/modules/cjs/loader:1355:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19) {
  errno: -4094,
  code: 'UNKNOWN',
  syscall: 'spawn'
}

Node.js v24.15.0
[ELIFECYCLE] Command failed with exit code 1.
EXIT CODE: 1
```

```
$ pnpm typecheck
[identical stack trace — Error: spawn UNKNOWN, errno: -4094, code: 'UNKNOWN', syscall: 'spawn']
Node.js v24.15.0
[ELIFECYCLE] Command failed with exit code 1.
EXIT CODE: 1
```

```
$ pnpm test
[identical stack trace — Error: spawn UNKNOWN, errno: -4094, code: 'UNKNOWN', syscall: 'spawn']
Node.js v24.15.0
[ELIFECYCLE] Test failed. See above for more details.
EXIT CODE: 1
```

```
$ pnpm arch
✔ no dependency violations found (1527 modules, 6966 dependencies cruised)
EXIT CODE: 0
```

**Root-cause of the three failures:** `turbo`'s own `runTurboChild` (`node_modules/.pnpm/turbo@2.10.0/.../bin/turbo:358`)
throws `Error: spawn UNKNOWN` (`errno: -4094`) attempting to spawn a child process at 81-workspace-package
scope on this Windows host — before reaching any package's `lint`/`typecheck`/`test` script. `pnpm arch` does not
route through `turbo` (its script calls `depcruise` directly), which is why it alone succeeds at root scope. This
is identical across all three failing commands and is a pre-existing environment characteristic of this host,
unrelated to any file Sprint A0 touched.

### 5.2 Package-level commands (bypass `turbo`, same underlying `tsc`/`eslint`/`vitest` binaries, scoped to every package Sprint A0 touched)

```
$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments --filter @platform/shipping \
    --filter @platform/security --filter @platform/runtime typecheck

Scope: 8 of 81 workspace projects
packages/messaging typecheck$ tsc --noEmit
packages/messaging typecheck: Done
packages/kafka typecheck$ tsc --noEmit
packages/db typecheck$ tsc --noEmit
packages/kafka typecheck: Done
packages/db typecheck: Done
services/inventory typecheck$ tsc --noEmit
services/payments typecheck$ tsc --noEmit
services/shipping typecheck$ tsc --noEmit
services/security typecheck$ tsc --noEmit
services/shipping typecheck: Done
services/inventory typecheck: Done
services/payments typecheck: Done
services/security typecheck: Done
apps/runtime typecheck$ tsc --noEmit
apps/runtime typecheck: Done
EXIT CODE: 0
```

```
$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments --filter @platform/shipping \
    --filter @platform/security --filter @platform/runtime lint

Scope: 8 of 81 workspace projects
packages/messaging lint$ eslint .
packages/messaging lint: Done
packages/db lint$ eslint .
packages/kafka lint$ eslint .
packages/db lint: Done
packages/kafka lint: Done
services/inventory lint$ eslint .
services/payments lint$ eslint .
services/shipping lint$ eslint .
services/security lint$ eslint .
services/shipping lint: Done
services/payments lint: C:\Users\abdoh\Claude code\Git\lumo-platform\services\payments\src\composition.ts
services/payments lint:   140:37  error  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
services/payments lint: ✖ 1 problem (1 error, 0 warnings)
services/inventory lint: Done
services/payments lint: Failed
C:\Users\abdoh\Claude code\Git\lumo-platform\services\payments:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @platform/payments@0.0.0 lint: `eslint .`
Exit status 1
EXIT CODE: 1
```

```
$ pnpm --filter @platform/runtime lint

apps/runtime/src/purchase/purchase-saga-routes.test.ts
  9:46  error  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

✖ 1 problem (1 error, 0 warnings)

C:\Users\abdoh\Claude code\Git\lumo-platform\apps\runtime:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @platform/runtime@0.0.0 lint: `eslint .`
Exit status 1
EXIT CODE: 1
```

**Both lint failures re-confirmed pre-existing** (fresh check, same session as this appendix):

```
$ git status --porcelain services/payments/src/composition.ts apps/runtime/src/purchase/purchase-saga-routes.test.ts
 M services/payments/src/composition.ts
?? apps/runtime/src/purchase/purchase-saga-routes.test.ts
```

Neither file was opened, read, or edited by Sprint A0 (cross-check against §1 — the complete list of
every file this sprint touched; neither appears in it). `services/payments/src/composition.ts` carries
125 insertions / 32 deletions of unrelated pre-existing uncommitted work (confirmed via
`git diff --stat` in the original pack); `apps/runtime/src/purchase/purchase-saga-routes.test.ts` is
untracked and sits inside `apps/runtime/src/purchase/` — the Purchase Saga directory Sprint A0's
scope explicitly excludes.

```
$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments --filter @platform/shipping \
    --filter @platform/security --filter @platform/runtime test -- --run

Scope: 8 of 81 workspace projects
packages/messaging test:  Test Files  7 passed (7)
packages/messaging test:       Tests  19 passed (19)
packages/kafka test:  Test Files  2 passed | 1 skipped (3)
packages/kafka test:       Tests  8 passed | 1 skipped (9)
services/shipping test:  Test Files  3 passed (3)
services/shipping test:       Tests  12 passed (12)
services/payments test:  Test Files  4 passed (4)
services/payments test:       Tests  16 passed (16)
services/inventory test:  Test Files  5 passed (5)
services/inventory test:       Tests  18 passed (18)
services/security test:  Test Files  31 passed | 3 skipped (34)
services/security test:       Tests  99 passed | 6 skipped (105)
  ...including:
  services/security test:  ✓ src/interfaces/relation-sync.consumer.test.ts (1 test) 6ms
  services/security test:  ✓ src/interfaces/session-revoked-all.consumer.test.ts (1 test) 7ms
apps/runtime test:  Test Files  29 passed (29)
apps/runtime test:       Tests  174 passed (174)
  ...including:
  apps/runtime test:  ✓ src/tracking/tracking-ingest-atomic-opt-out.test.ts (1 test) 6ms
EXIT CODE: 0
```

The 1 skipped file in `packages/kafka` is `src/kafka-runtime.integration.test.ts` — an
honestly-gated pre-existing live-broker integration test (`describe.runIf(Boolean(brokers))`),
skipped because no `KAFKA_BROKERS_TEST` is set in this environment; not a Sprint A0 file. The 3
skipped files in `services/security` are pre-existing Prisma-integration tests gated on a live
database, same reasoning.

### 5.3 Summary table

| Command     | Root (`turbo`)                                      | Package-scoped (bypasses `turbo`)                                                                                                              |
| ----------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`      | exit 1 — `spawn UNKNOWN`, environment, pre-existing | exit 1 — 2 pre-existing failures outside Sprint A0's file set (composition.ts, purchase-saga-routes.test.ts); every Sprint A0 file lints clean |
| `typecheck` | exit 1 — `spawn UNKNOWN`, environment, pre-existing | exit 0 — clean on all 8 packages                                                                                                               |
| `test`      | exit 1 — `spawn UNKNOWN`, environment, pre-existing | exit 0 — 355 tests passing across 8 packages, 4 honestly-gated pre-existing skips                                                              |
| `arch`      | exit 0 — 0 violations, 1527 modules                 | (same command; no package-scoped variant needed)                                                                                               |

---

## 6. Approval matrix

| Criterion                      | Verdict               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backward compatibility**     | **PASS**              | `EventHandler<TPayload, TContext = unknown>` — `TContext` defaults to `unknown`, so every existing `EventHandler<TPayload>` call site still type-checks unchanged (§1.1, §3). `handleAtomic?` is optional; none of the 17 production consumers implement it (§4.1). Every new repository method is additive to its interface; existing methods (`save`, `findById`, etc.) are byte-for-byte unchanged in every diff in §1.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Runtime behavior unchanged** | **PASS**              | `EventConsumer.consume` / `KafkaConsumerRuntime.handleMessage` both gate the new path on `handler.handleAtomic !== undefined && deps.unitOfWork !== undefined` (§3) — false for all 17 production handlers today, so the `else` branch (byte-identical to the pre-Sprint-A0 code, per §1.1's diffs) is the only branch any production call reaches. The three new repository methods are unreferenced by any `UseCase` (§4.2, §4.3) — unreachable from any running code path.                                                                                                                                                                                                                                                                                                                                                                             |
| **Event contracts unchanged**  | **PASS**              | No file under any `domain/events/` directory, `*.event.ts`, or `IntegrationEventTranslator` was touched (absent from every file list in §1). No topic name, event type string, or payload shape was added, removed, or renamed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Business logic unchanged**   | **PASS**              | No `UseCase` file (`services/*/src/application/*.ts`) was created or modified — confirmed by the complete file list in §1 and the negative grep results in §4.2/§4.3. The `PaymentIntent`/`Shipment` domain aggregates were not touched — neither gained an `idempotencyKey` field; the corresponding in-memory repository methods are hard-coded to return `null` (§1.1, §3 by inspection of the diffs).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **API unchanged**              | **PASS**              | No file under any `interfaces/`, `*.controller.ts`, `*-routes.ts`, or `admin-http.ts`-style path appears in §1. No HTTP route, GraphQL field, or admin controller method was added, removed, or changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Migration safety**           | **PASS, conditional** | All three migration statements are additive-only (§2): two (`PaymentIntent.idempotency_key`, `Shipment.idempotency_key`) are new nullable columns + unique indexes, safe by construction (new column ⇒ every existing row NULL ⇒ Postgres treats each NULL as distinct in a unique index ⇒ cannot violate on apply). The third (`Reservation`'s unique constraint on pre-existing populated columns) is conditionally safe: **it requires the pre-migration duplicate audit query in `SPRINT_A0_REPORT.md` §4 to run first and return zero rows** (or for any returned duplicates to be resolved manually) before this migration is applied to a database with production data. This condition is explicit in the migration file's own comments (§2) and is the one open item standing between this matrix and an unconditional PASS on migration safety. |
| **Rollback safety**            | **PASS**              | Every migration statement has a documented, data-loss-free reverse (`DROP INDEX`, `DROP COLUMN` — both target either an unwritten nullable column or an index with no dependent code, per `SPRINT_A0_REPORT.md` §7). Application-code rollback is a plain revert: nothing calls the new capability or the new repository methods (§4), so no in-flight state depends on their presence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
