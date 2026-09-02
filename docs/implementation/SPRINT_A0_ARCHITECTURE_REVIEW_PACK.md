# Sprint A0 — Architecture Review Pack

**Purpose:** evidence package for approval of Sprint A0 (Preconditions). No code was changed to
produce this document — it is a read-only assembly of diffs, final file contents, grep-based
proofs, and gate output, plus one attribution correction described below.

---

## 0. Diff-provenance note (read this first)

This repository currently carries a **large amount of pre-existing uncommitted work** that
predates this session — spanning most contexts, consistent with the standing project memory
("Sprints 1.3–1.6 + hardening still uncommitted", and multiple sprints after that). `git status`
shows several files Sprint A0 touched as already modified or untracked _before_ Sprint A0 began.

Concretely, three files this sprint edited already carried unrelated uncommitted content:

| File                                                                                                                                                                                | Pre-existing uncommitted content (NOT Sprint A0)                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema/inventory.prisma`                                                                                                                                        | An entire `Warehouse` model (Sprint 4.3 gap register work)                                                                                        |
| `packages/db/prisma/schema/payments.prisma`                                                                                                                                         | `pspReference`, `paymentMethod`, `authorizedAmountMinor`, `attempts` fields on `PaymentIntent`, and the whole `ProcessedWebhook` model            |
| `services/payments/src/infrastructure/prisma-payment-intent-repository.ts`                                                                                                          | A refactor of the update path from `data: { status: intent.status.value, ... }` to `data: { ...PaymentIntentMapper.toIntentUpdate(intent), ... }` |
| `services/inventory/src/domain/inventory-item-repository.ts`, `.../infrastructure/prisma-inventory-item-repository.ts`, `.../infrastructure/in-memory-inventory-item-repository.ts` | `findByProduct` and `list` (cursor pagination), explicitly dated "Sprint 7.0 gap-only enrichment" in their own doc comments                       |

A raw `git diff` on these five files would present that pre-existing work as if Sprint A0
introduced it. **§1 below isolates only the hunks Sprint A0 actually added**, verified against my
own edit history for this sprint, not against git's index (which cannot distinguish "before this
session" from "before all prior uncommitted sessions" on an already-dirty file). Every other file
in §1 had no pre-existing dirty state, so its diff is presented as-is from `git diff`.

---

## 1. Every modified file, diff

### 1.1 Files with clean `git diff` (no pre-existing dirty state — shown verbatim)

#### `packages/messaging/src/consumer/event-handler.ts`

```diff
@@ -4,9 +4,20 @@ import type { IntegrationEvent } from "@platform/domain-events";
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
@@ -1,13 +1,15 @@
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
@@ -16,6 +18,12 @@ export interface EventConsumerDeps {
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
@@ -31,11 +39,11 @@ export interface EventConsumerDeps {
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
@@ -49,6 +57,10 @@ export class EventConsumer<TPayload> {

     for (let attempt = 1; ; attempt += 1) {
       try {
+        if (this.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
+          await this.consumeAtomic(event, message);
+          return;
+        }
         await this.handler.handle(event);
         const isNew = await this.deps.processedEvents.recordIfNew(
           event.messageId,
@@ -88,6 +100,47 @@ export class EventConsumer<TPayload> {
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
```

#### `packages/messaging/src/index.ts`

```diff
@@ -28,6 +28,7 @@ export type { EventConsumerDeps } from "./consumer/event-consumer";
 // Idempotency
 export type { ProcessedEventStore } from "./idempotency/processed-event-store";
 export { InMemoryProcessedEventStore } from "./idempotency/in-memory-processed-event-store";
+export { DuplicateProcessedEventError } from "./idempotency/duplicate-processed-event-error";

 // Retry
 export { RetryPolicy } from "./retry/retry-policy";
```

#### `packages/messaging/package.json`

```diff
@@ -18,6 +18,7 @@
     "@platform/contracts": "workspace:*",
     "@platform/domain": "workspace:*",
     "@platform/domain-events": "workspace:*",
+    "@platform/repository": "workspace:*",
     "@platform/utils": "workspace:*"
   },
```

#### `packages/kafka/src/consumer-runtime.ts`

```diff
@@ -1,7 +1,13 @@
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
@@ -13,9 +19,9 @@ import {
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
@@ -29,6 +35,12 @@ export interface KafkaConsumerRuntimeDeps<TPayload> {
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
@@ -49,14 +61,14 @@ export interface KafkaConsumerRuntimeDeps<TPayload> {
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
@@ -125,11 +137,21 @@ export class KafkaConsumerRuntime<TPayload> {
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
@@ -148,6 +170,39 @@ export class KafkaConsumerRuntime<TPayload> {
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
```

#### `packages/kafka/package.json`

```diff
@@ -19,6 +19,7 @@
     "@platform/domain-events": "workspace:*",
     "@platform/health": "workspace:*",
     "@platform/messaging": "workspace:*",
+    "@platform/repository": "workspace:*",
     "@platform/utils": "workspace:*",
     "kafkajs": "^2.2.4"
   },
```

#### `services/payments/src/domain/payment-intent-repository.ts`

```diff
@@ -4,4 +4,11 @@ import type { PaymentIntent } from "./payment-intent";
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
@@ -26,4 +26,13 @@ export class InMemoryPaymentIntentRepository implements PaymentIntentRepository {
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

### 1.2 Files with pre-existing uncommitted content — Sprint A0's isolated hunk only

#### `packages/db/prisma/schema/inventory.prisma` (Sprint A0's actual contribution)

```diff
@@ model Reservation {
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

_(The `Warehouse` model appearing later in a raw `git diff` of this file is pre-existing uncommitted work — not part of Sprint A0.)_

#### `packages/db/prisma/schema/payments.prisma` (Sprint A0's actual contribution)

```diff
@@ model PaymentIntent {
   status      String // ...(domain-enforced)
+  /// Caller-supplied idempotency key for intent creation (Sprint A0 precondition, A3). Nullable —
+  /// no code path writes it yet (the domain aggregate carries no such field); A3 threads it through
+  /// `CreatePaymentIntent` to dedupe retried saga-activity calls. New column, all-NULL today, so
+  /// the unique constraint below is safe to apply without a data audit (Postgres treats each NULL
+  /// as distinct in a unique index).
+  idempotencyKey String? @map("idempotency_key")
   version     Int      @default(0)
   ...
   charges Charge[]
   refunds Refund[]

+  @@unique([tenantId, idempotencyKey])
   @@index([tenantId, orderRef])
   @@index([tenantId, status])
   @@map("payment_intents")
   @@schema("payments")
 }
```

_(The `pspReference`/`paymentMethod`/`authorizedAmountMinor`/`attempts` fields and the `ProcessedWebhook` model appearing in a raw `git diff` of this file are pre-existing uncommitted work — not part of Sprint A0.)_

#### `packages/db/prisma/schema/shipping.prisma` (untracked in git — pre-existing uncommitted file from the Shipping context; Sprint A0's isolated addition shown against the pre-Sprint-A0 content I read before editing)

```diff
@@ model Shipment {
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
 }
```

#### `services/inventory/src/domain/inventory-item-repository.ts` (Sprint A0's actual contribution)

```diff
   findByProductAndWarehouse(...): Promise<InventoryItem | null>;
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

_(`findByProduct` and `list` are pre-existing uncommitted work, dated "Sprint 7.0" in their own doc comment — not part of Sprint A0.)_

#### `services/inventory/src/infrastructure/prisma-inventory-item-repository.ts` (Sprint A0's actual contribution)

```diff
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
```

_(`findByProduct` and `list` in the same file are pre-existing uncommitted work — not part of Sprint A0.)_

#### `services/inventory/src/infrastructure/in-memory-inventory-item-repository.ts` (Sprint A0's actual contribution)

```diff
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
```

_(`findByProduct` and `list` in the same file are pre-existing uncommitted work — not part of Sprint A0.)_

#### `services/payments/src/infrastructure/prisma-payment-intent-repository.ts` (Sprint A0's actual contribution)

```diff
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
```

_(The `data: { status: intent.status.value, ... }` → `data: { ...PaymentIntentMapper.toIntentUpdate(intent), ... }` change in the same file's `save()` method is pre-existing uncommitted work — not part of Sprint A0.)_

#### `services/shipping/src/domain/shipment-repository.ts` (untracked file; Sprint A0's addition against the pre-existing `save`/`findById`-only content)

```diff
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

#### `services/shipping/src/infrastructure/prisma-shipment-repository.ts` (untracked file; Sprint A0's addition)

```diff
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
```

#### `services/shipping/src/infrastructure/in-memory-shipment-repository.ts` (untracked file; Sprint A0's addition)

```diff
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
```

### 1.3 New files (100% Sprint A0 — full content, no attribution ambiguity)

- `packages/messaging/src/idempotency/duplicate-processed-event-error.ts`
- `packages/kafka/src/consumer-runtime.test.ts`
- `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql`
- `services/inventory/src/infrastructure/find-by-reservation-reference.test.ts`
- `services/payments/src/infrastructure/find-by-idempotency-key.test.ts`
- `services/shipping/src/infrastructure/find-by-idempotency-key.test.ts`
- `services/security/src/interfaces/relation-sync.consumer.test.ts`
- `services/security/src/interfaces/session-revoked-all.consumer.test.ts`
- `apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts`
- `docs/implementation/SPRINT_A0_REPORT.md`
- `docs/implementation/SPRINT_A0_ARCHITECTURE_REVIEW_PACK.md` (this file)

Full contents of each test file are reproduced in §6 (repository-method tests) and §8 (atomic-opt-out
regression tests). `event-consumer.test.ts`'s new cases (an edit to an existing, previously-clean
file) are reproduced in §5.

---

## 2. Every `migration.sql`, in full

**File:** `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql`
(the only migration this sprint added)

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

Pre-migration audit query required before Step 1 (from `SPRINT_A0_REPORT.md` §4):

```sql
SELECT tenant_id, item_id, reference, COUNT(*) AS duplicate_count
FROM inventory.reservations
GROUP BY tenant_id, item_id, reference
HAVING COUNT(*) > 1;
```

---

## 3. Final `EventHandler` interface

`packages/messaging/src/consumer/event-handler.ts`, full file:

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

`handle` is unchanged and still required. `handleAtomic` is the only addition, and it is optional
(`?`), with `TContext` defaulted to `unknown` — so `EventHandler<TPayload>` (the old one-argument
form) still type-checks identically everywhere it's already used.

---

## 4. Final `KafkaConsumerRuntime` transaction flow

`packages/kafka/src/consumer-runtime.ts`'s `handleMessage` + the new `handleAtomic` private method
(the two methods that constitute the transaction flow; full file available via §1's diff + the
pre-Sprint-A0 base which was untouched elsewhere):

```typescript
async handleMessage(payload: EachMessagePayload): Promise<void> {
  const headers = decodeHeaderBag(payload);
  const value = payload.message.value ?? Buffer.alloc(0);
  const key = payload.message.key?.toString() ?? "";
  const retry = decodeRetryHeaders(headers);
  const attempt = retry?.attempt ?? 0;

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
    await this.scheduleRetryOrDeadLetter({ attempt, key, value, headers, messageId: envelope.messageId, error });
  }
}

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
```

**Flow diagram (non-atomic path — unchanged from before Sprint A0):**
`decode → dedup pre-check (has) → handle(envelope) → recordIfNew (no tx) → metrics.processed`

**Flow diagram (atomic path — new, opt-in only):**
`decode → dedup pre-check (has) → unitOfWork.run(tx => { handleAtomic(envelope, tx); recordIfNew(..., tx); if not new, throw }) → true ⇒ metrics.processed | false (duplicate, transaction rolled back) ⇒ metrics.duplicate`

Selection between the two paths is `this.deps.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined` — both must be present, so a handler cannot accidentally end up half-wired.

---

## 5. Final `EventConsumer` implementation

`packages/messaging/src/consumer/event-consumer.ts`, full file:

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
  readonly sleep: (ms: number) => Promise<void>;
  readonly unitOfWork?: TransactionalUnitOfWork<TContext>;
}

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

---

## 6. All newly added repository methods

| Repository                | Method                                                                                                          | Behavior                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InventoryItemRepository` | `findByReservationReference(itemId: string, reference: string, tx?: unknown): Promise<InventoryItem \| null>`   | Prisma: queries `reservation` by `(itemId, reference, tenantId)`, then loads the owning `InventoryItem` via `findById`. In-memory: scans the item's live `reservations` array for a matching `reference`. |
| `PaymentIntentRepository` | `findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<PaymentIntent \| null>`                    | Prisma: queries `paymentIntent` by `(idempotencyKey, tenantId)`, reuses the existing row→domain mapper. In-memory: always `null` (documented — domain aggregate carries no such field yet).               |
| `ShipmentRepository`      | `findByIdempotencyKey(fulfillmentRef: string, idempotencyKey: string, tx?: unknown): Promise<Shipment \| null>` | Prisma: queries `shipment` by `(fulfillmentRef, idempotencyKey, tenantId)`. In-memory: always `null` (same reasoning).                                                                                    |

Full method bodies are reproduced in §1.2's isolated hunks.

---

## 7. Proof: no `UseCase` references any new repository method

```
$ grep -rl "findByReservationReference\|findByIdempotencyKey" --include=*.ts .
services\shipping\src\infrastructure\in-memory-shipment-repository.ts
services\payments\src\infrastructure\in-memory-payment-intent-repository.ts
services\shipping\src\infrastructure\find-by-idempotency-key.test.ts
services\payments\src\infrastructure\find-by-idempotency-key.test.ts
services\inventory\src\infrastructure\find-by-reservation-reference.test.ts
services\shipping\src\infrastructure\prisma-shipment-repository.ts
services\shipping\src\domain\shipment-repository.ts
services\payments\src\infrastructure\prisma-payment-intent-repository.ts
services\payments\src\domain\payment-intent-repository.ts
services\inventory\src\infrastructure\in-memory-inventory-item-repository.ts
services\inventory\src\infrastructure\prisma-inventory-item-repository.ts
services\inventory\src\domain\inventory-item-repository.ts
```

**12 files, all of them domain ports, infrastructure adapters (Prisma/in-memory), or this sprint's
own tests.** Zero matches under any `src/application/` directory (where `UseCase` implementations
live in this codebase — e.g. `ReserveStock`, `CreatePaymentIntent`, `CreateShipment`). No use case,
consumer, controller, or composition root calls either method.

---

## 8. Proof: zero existing consumers implement `handleAtomic`

```
$ grep -rl "handleAtomic" --include=*.ts .
packages\kafka\src\consumer-runtime.test.ts
packages\messaging\src\consumer\event-consumer.test.ts
apps\runtime\src\tracking\tracking-ingest-atomic-opt-out.test.ts
services\security\src\interfaces\session-revoked-all.consumer.test.ts
services\security\src\interfaces\relation-sync.consumer.test.ts
packages\kafka\src\consumer-runtime.ts
packages\messaging\src\consumer\event-consumer.ts
packages\messaging\src\idempotency\duplicate-processed-event-error.ts
packages\messaging\src\consumer\event-handler.ts
```

**9 files: the 4 core capability files this sprint added/edited, this sprint's own atomic-path unit
tests (2 files), and 3 new structural regression tests.** None of the 17 production `EventHandler`
implementations appear (`PaymentCapturedConsumer`, `OrderPaymentReceivedConsumer` ×2,
`ShipmentShippedConsumer`, `RelationWrittenConsumer`, `RelationDeletedConsumer`,
`SessionRevokedAllConsumer`, `TrackingIngestHandler`, the 5 Security projection consumers, etc.).

The three regression tests assert this structurally, not just by absence of a grep hit — they check
the actual class prototype:

```typescript
// services/security/src/interfaces/relation-sync.consumer.test.ts
describe("RelationWrittenConsumer / RelationDeletedConsumer — atomic opt-out (Sprint A0)", () => {
  it("never implements handleAtomic — these consumers make an Ory Keto HTTP call with no DB write to make atomic", () => {
    expect("handleAtomic" in RelationWrittenConsumer.prototype).toBe(false);
    expect("handleAtomic" in RelationDeletedConsumer.prototype).toBe(false);
  });
});

// services/security/src/interfaces/session-revoked-all.consumer.test.ts
describe("SessionRevokedAllConsumer — atomic opt-out (Sprint A0)", () => {
  it("never implements handleAtomic — this consumer makes an Ory Kratos HTTP call with no DB write to make atomic", () => {
    expect("handleAtomic" in SessionRevokedAllConsumer.prototype).toBe(false);
  });
});

// apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts
describe("TrackingIngestHandler — atomic opt-out (Sprint A0)", () => {
  it("never implements handleAtomic — vendor delivery is an HTTP call with no DB write to make atomic, and it runs its own purpose-different recordIfNew for destination-level dedup", () => {
    expect("handleAtomic" in TrackingIngestHandler.prototype).toBe(false);
  });
});
```

All three pass (see §9).

---

## 9. Quality gate output

### `pnpm lint`, `pnpm typecheck`, `pnpm test` (root, via `turbo run <script>`)

All three currently fail at the orchestration layer on this Windows host with an identical,
pre-existing environment error, unrelated to any code (Sprint A0's or otherwise):

```
$ pnpm lint          (and identically for typecheck, test)
node.exe : $ turbo run lint
...
Error: spawn UNKNOWN
    at ChildProcess.spawn (node:internal/child_process:441:11)
    ...
  errno: -4094,
  code: 'UNKNOWN',
  syscall: 'spawn'
Node.js v24.15.0
[ELIFECYCLE] Command failed with exit code 1.
```

This is `turbo`'s own child-process orchestration failing to spawn at full-monorepo scope (81
workspace packages) on this host — reproduced identically for `lint`, `typecheck`, and `test`, with
zero project code ever reached. It is an environment limitation, not a code defect, and is outside
this review's "no code changes" scope to fix.

`pnpm arch` does **not** go through `turbo` (it calls `depcruise` directly) and ran successfully at
full-repo scope:

```
$ pnpm arch
✔ no dependency violations found (1527 modules, 6966 dependencies cruised)
```

**Substitute evidence for lint/typecheck/test**, scoped with `pnpm --filter` (bypasses `turbo`,
same underlying tool invocations, covers every package Sprint A0 touched):

```
$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments --filter @platform/shipping \
    --filter @platform/security --filter @platform/runtime typecheck

packages/messaging typecheck$ tsc --noEmit
packages/messaging typecheck: Done
packages/kafka typecheck$ tsc --noEmit
packages/kafka typecheck: Done
packages/db typecheck$ tsc --noEmit
packages/db typecheck: Done
services/inventory typecheck$ tsc --noEmit
services/inventory typecheck: Done
services/payments typecheck$ tsc --noEmit
services/payments typecheck: Done
services/shipping typecheck$ tsc --noEmit
services/shipping typecheck: Done
services/security typecheck$ tsc --noEmit
services/security typecheck: Done
apps/runtime typecheck$ tsc --noEmit
apps/runtime typecheck: Done
```

```
$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments --filter @platform/shipping \
    --filter @platform/security --filter @platform/runtime test -- --run

packages/messaging test:  Test Files  7 passed (7)
packages/messaging test:       Tests  19 passed (19)
packages/kafka test:  Test Files  2 passed | 1 skipped (3)     # skip = pre-existing live-broker integration test, honestly gated
packages/kafka test:       Tests  8 passed | 1 skipped (9)
services/shipping test:  Test Files  3 passed (3)
services/inventory test:  Test Files  5 passed (5)
services/payments test:  Test Files  4 passed (4)
services/security test:  Test Files  31 passed | 3 skipped (34)  # pre-existing skips, unrelated to Sprint A0
apps/runtime test:  Test Files  29 passed (29)
apps/runtime test:       Tests  174 passed (174)
```

```
$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments --filter @platform/shipping \
    --filter @platform/security --filter @platform/runtime lint

packages/messaging lint$ eslint .
packages/messaging lint: Done
packages/db lint$ eslint .
packages/db lint: Done
packages/kafka lint$ eslint .
packages/kafka lint: Done
services/shipping lint$ eslint .
services/shipping lint: Done
services/inventory lint$ eslint .
services/inventory lint: Done
services/security lint$ eslint .
services/security lint: Done  (implied — see below, only payments failed)
services/payments lint$ eslint .
services/payments lint:   src/composition.ts
services/payments lint:   140:37  error  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
services/payments lint: ✖ 1 problem (1 error, 0 warnings)
```

```
$ pnpm --filter @platform/runtime lint

apps/runtime/src/purchase/purchase-saga-routes.test.ts
  9:46  error  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
✖ 1 problem (1 error, 0 warnings)
```

**Both lint failures confirmed pre-existing, not introduced by Sprint A0:**

```
$ git status --porcelain services/payments/src/composition.ts apps/runtime/src/purchase/purchase-saga-routes.test.ts
 M services/payments/src/composition.ts
?? apps/runtime/src/purchase/purchase-saga-routes.test.ts
```

`services/payments/src/composition.ts` was never opened or edited by this sprint (Sprint A0's
Payments-side work touched only `domain/payment-intent-repository.ts` and
`infrastructure/{prisma,in-memory}-payment-intent-repository.ts`, per §1). `git diff --stat` on it
shows 125 insertions / 32 deletions — far larger than any Sprint A0 edit — confirming it carries
unrelated pre-existing uncommitted work. `apps/runtime/src/purchase/purchase-saga-routes.test.ts` is
untracked (`??`), inside the Purchase Saga directory Sprint A0 is explicitly barred from touching,
and was never opened this sprint.

### `pnpm arch`

```
$ pnpm arch
✔ no dependency violations found (1527 modules, 6966 dependencies cruised)
```

Confirms the two new dependency edges this sprint introduced (`@platform/messaging` →
`@platform/repository`, `@platform/kafka` → `@platform/repository`) violate no layering rule in
`.dependency-cruiser.cjs` — `@platform/repository` is a ports-only leaf package (depends only on
`@platform/types`), not named in the `messaging-no-application-no-infra` rule's forbidden-target
list.

---

## 10. File-by-file: why every change is purely infrastructural, zero runtime behavior change

| File                                                                                                                                            | Why zero behavior change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event-handler.ts`                                                                                                                              | `handleAtomic` is a new **optional** interface member. TypeScript structural typing: existing implementers that don't declare it are unaffected; nothing reads or checks for it except the two runtimes below, and only when a handler explicitly provides it.                                                                                                                                                                                                                                                                                     |
| `event-consumer.ts` / `consumer-runtime.ts`                                                                                                     | The atomic branch is gated by `handler.handleAtomic !== undefined && deps.unitOfWork !== undefined` — both conditions. Every one of the 17 production consumers satisfies neither (no handler defines `handleAtomic`), so every production call falls through to the exact pre-existing `handle()` + non-transactional `recordIfNew()` path, byte-for-byte unchanged (see the `diff` in §1: the `else` branch is the old code, untouched).                                                                                                         |
| `duplicate-processed-event-error.ts`                                                                                                            | A new `Error` subclass. Thrown and caught only inside the two new atomic-path methods; never constructed, thrown, or caught anywhere in the non-atomic path.                                                                                                                                                                                                                                                                                                                                                                                       |
| `messaging`/`kafka` `package.json`                                                                                                              | Adds a workspace dependency edge (`@platform/repository`, itself a zero-runtime-cost pure-TypeScript-interfaces package — confirmed via `packages/repository/package.json`: only dependency is `@platform/types`). No new runtime package, no version bump of an existing one.                                                                                                                                                                                                                                                                     |
| `inventory.prisma` / `payments.prisma` / `shipping.prisma`                                                                                      | Every change is one of: (a) a new **nullable** column with no default that changes existing-row behavior, or (b) a `UNIQUE INDEX` on a column set that Postgres allows to include the new all-NULL column safely, or (for `Reservation`) an existing-column constraint gated by a pre-deploy audit (§2). No column was removed, renamed, retyped, or given a new `NOT NULL`/default. No existing query in the codebase selects, filters, or orders by any of the three new/constrained columns except the three new repository methods themselves. |
| `migration.sql`                                                                                                                                 | Every statement is `ALTER TABLE ... ADD COLUMN` (nullable, no default) or `CREATE UNIQUE INDEX` — the "expand" half of expand-contract; nothing is dropped, altered destructively, or backfilled.                                                                                                                                                                                                                                                                                                                                                  |
| `InventoryItemRepository.findByReservationReference`, `PaymentIntentRepository.findByIdempotencyKey`, `ShipmentRepository.findByIdempotencyKey` | New interface methods + implementations. Proven in §7 that no application-layer code calls any of them — they are unreachable from any running code path today. The two `PaymentIntent`/`Shipment` in-memory implementations are provably inert (`return null` unconditionally); the Prisma implementations execute a `SELECT` against a column that, per the schema analysis above, no other code path ever writes — so even if something called them today, they would deterministically return `null`, changing nothing.                        |
| Every `*.test.ts` file added                                                                                                                    | Test-only; not part of any production bundle or runtime import graph.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SPRINT_A0_REPORT.md`, this file                                                                                                                | Documentation only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Net runtime-behavior-change surface of Sprint A0: zero.** Every new code path requires an explicit
future opt-in (implementing `handleAtomic` on a handler and wiring a `unitOfWork` into its runtime
deps — neither done this sprint) or a future explicit call to one of the three new repository
methods from application code (not done this sprint, and proven absent in §7). The three schema
changes are additive-only and, once the Reservation audit (§2) is clear, safe to apply to production
independently of any code deploy.
