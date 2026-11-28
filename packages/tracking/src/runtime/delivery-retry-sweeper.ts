/**
 * The durable retry sweeper (Tracking P1-D2) — one pass over the deliveries parked in the queue.
 *
 * `deliver` retries five times in-process, which absorbs a blip. A vendor outage that outlasts that, or
 * a worker restart in the middle of one, would otherwise lose the conversion. A delivery that failed in
 * a way the vendor may recover from is therefore parked (`DeliveryRetryQueuePort`) and this pass takes
 * it up again, on a growing schedule, until the vendor's own window closes (`retry-schedule.ts`).
 *
 * ## What a retry sends
 *
 * The SAME bytes under the SAME `event_id`, read back from the immutable event record: the stored
 * business payload of the destination's history entry, the stored envelope. Nothing is mapped or enriched
 * again, so a retry cannot drift from the first try, and a vendor that did receive the first one (a lost
 * response) deduplicates the second on `event_id`/`dedup_id` instead of counting it twice. Credentials
 * are resolved at send time by the adapter, exactly as for a first send: a connection the merchant
 * reconnected meanwhile is picked up, one they removed ends the retry (a permanent refusal).
 *
 * ## Idempotency
 *
 * `deliver`'s processed-marker (`destination:eventId`) was written by the FIRST attempt, so it would
 * answer every retry with `skipped_duplicate` — a retry that sends nothing and calls itself delivered.
 * The sweeper replaces that port with one that always says "new": the guard against a double send is the
 * queue's claim (a lease taken under `FOR UPDATE SKIP LOCKED`), and, past that, the vendor's own dedup
 * on the unchanged event id. The residual case — a sweeper that sent and died before settling — is one
 * extra send of an event the vendor already holds, which it discards.
 *
 * ## Outcomes
 *
 * - delivered → `delivered`.
 * - blocked by a gate, or refused for good by the vendor (4xx, revoked token, no credential) → dead letter
 *   with the reason: re-sending cannot change the answer.
 * - the vendor failed again → the next slot on the schedule; when the window leaves no useful moment,
 *   dead-lettered as `window_closed` (a platform dead-letter row carries the payload so it stays
 *   recoverable by an operator).
 * - an open circuit / empty bucket → looked at again soon, WITHOUT counting a failed round (no vendor
 *   call was made).
 *
 * Logs and counters here are counts only; the queue row holds no payload and no identity.
 */

import {
  deadLetterDelivery,
  deliver,
  type DeliveryDeps,
  type DeliveryResult,
} from "../delivery/delivery-pipeline";
import {
  toRoutingContext,
  type DestinationDefinition,
  type DestinationRegistryPort,
} from "../delivery/destination";
import { planNextRetry } from "../delivery/retry-schedule";
import type { EnrichedEnvelope } from "../envelope/envelope";
import {
  deriveEventState,
  type DestinationHistoryEntry,
  type EventRecord,
  type EventRecordWriterPort,
  type RetryHistoryEntry,
  type StageHistoryEntry,
} from "../inspector/event-record";
import { buildRetryHistory } from "../inspector/record-delivery";
import {
  dispositionOf,
  storableError,
  type DeliveryRetryEntry,
  type DeliveryRetryQueuePort,
} from "./delivery-retry";
import type { DestinationStatePort } from "./delivery-runtime";

/** What the sweeper needs for one tenant, bound to ONE registry snapshot for ONE entry. */
export interface RetryTenantRuntime {
  readonly delivery: DeliveryDeps;
  readonly destinations: DestinationRegistryPort;
  readonly destinationState: DestinationStatePort;
  readonly records: EventRecordWriterPort & {
    get(eventId: string, tenantId: string): Promise<EventRecord | null>;
  };
}

export interface RetrySweepDeps {
  readonly queue: DeliveryRetryQueuePort;
  /** Resolves a tenant's runtime; called once per entry so a registry reload is picked up. */
  readonly runtimeFor: (tenantId: string) => Promise<RetryTenantRuntime>;
  readonly clock: { now(): Date };
  /** Entries claimed per round trip. */
  readonly batchSize: number;
  /** How long a claimed entry is reserved for this sweeper before another may take it. */
  readonly leaseMs: number;
  /** Stop starting new batches after this long (the lock the caller holds is finite). */
  readonly budgetMs: number;
  /** Jitter source; absent ⇒ the exact schedule. */
  readonly random?: () => number;
}

/** Counts only — safe to log. */
export interface RetrySweepReport {
  readonly claimed: number;
  readonly delivered: number;
  readonly rescheduled: number;
  readonly deadLettered: number;
  /** Entries whose handling threw (queue/record/registry unreachable); they come due again after the lease. */
  readonly errored: number;
}

const ALWAYS_NEW: DeliveryDeps["processed"] = { recordIfNew: () => Promise.resolve(true) };

type Settled = "delivered" | "rescheduled" | "dead_lettered";

export async function sweepDeliveryRetries(deps: RetrySweepDeps): Promise<RetrySweepReport> {
  const startedAt = deps.clock.now().getTime();
  let claimed = 0;
  let delivered = 0;
  let rescheduled = 0;
  let deadLettered = 0;
  let errored = 0;

  for (;;) {
    const batch = await deps.queue.claimDue({
      limit: deps.batchSize,
      now: deps.clock.now(),
      leaseMs: deps.leaseMs,
    });
    claimed += batch.length;

    for (const entry of batch) {
      try {
        const settled = await retryOne(deps, entry);
        if (settled === "delivered") delivered += 1;
        else if (settled === "rescheduled") rescheduled += 1;
        else deadLettered += 1;
      } catch {
        errored += 1;
      }
    }

    if (batch.length < deps.batchSize) break;
    if (deps.clock.now().getTime() - startedAt >= deps.budgetMs) break;
  }

  return { claimed, delivered, rescheduled, deadLettered, errored };
}

async function retryOne(deps: RetrySweepDeps, entry: DeliveryRetryEntry): Promise<Settled> {
  const key = { tenantId: entry.tenantId, eventId: entry.eventId, destination: entry.destination };
  const now = deps.clock.now();
  const runtime = await deps.runtimeFor(entry.tenantId);

  const record = await runtime.records.get(entry.eventId, entry.tenantId);
  if (record === null) {
    await deps.queue.markDeadLettered(key, "record_missing", now);
    return "dead_lettered";
  }
  const history = record.destinationHistory.find((item) => item.destination === entry.destination);
  if (history === undefined) {
    await deps.queue.markDeadLettered(key, "destination_entry_missing", now);
    return "dead_lettered";
  }
  const destination = runtime.destinations.resolve(entry.destination);
  if (destination === null || !destination.enabled) {
    // Disconnected or disabled since the failure: nothing to send to, and it will not come back by itself.
    await deps.queue.markDeadLettered(key, "destination_unavailable", now);
    await recordSettlement(
      runtime,
      record,
      history,
      "dead_lettered",
      [],
      "destination_unavailable",
      now,
    );
    return "dead_lettered";
  }

  const envelope = record.envelope;

  // The vendor no longer takes (or would mis-date) the event: never send, say why.
  if (now.getTime() >= entry.windowExpiresAt.getTime()) {
    await deadLetterAndSettle(deps, runtime, {
      entry,
      record,
      history,
      destination,
      envelope,
      reason: "window_expired",
      error: entry.lastError ?? "window_expired",
      now,
    });
    return "dead_lettered";
  }

  const state = runtime.destinationState.get(destination, now.getTime());
  const result = await deliver(
    { ...runtime.delivery, processed: ALWAYS_NEW, deferTransientFailures: true },
    {
      envelope,
      destination,
      routingContext: toRoutingContext(envelope),
      circuit: state.circuit,
      rateLimit: state.rateLimit,
      renderedPayload: history.renderedPayload,
      // Judged at the moment the event was accepted: its age is bounded by the vendor window instead.
      evaluateAt: new Date(envelope.receivedAt),
    },
  );
  runtime.destinationState.set(destination.key, {
    circuit: result.circuit,
    rateLimit: result.rateLimit,
  });

  const settledAt = deps.clock.now();
  const disposition = dispositionOf(result.outcome);

  switch (disposition.kind) {
    case "done": {
      await deps.queue.markDelivered(key, settledAt);
      await recordSettlement(
        runtime,
        record,
        history,
        "delivered",
        attemptsOf(result, history, settledAt),
        undefined,
        settledAt,
      );
      return "delivered";
    }
    case "permanent": {
      await deps.queue.markDeadLettered(key, storableError(disposition.reason), settledAt);
      await recordSettlement(
        runtime,
        record,
        history,
        "dead_lettered",
        attemptsOf(result, history, settledAt),
        disposition.reason,
        settledAt,
      );
      return "dead_lettered";
    }
    case "transient": {
      const attempts = entry.attempts + (disposition.countsAsFailure ? 1 : 0);
      const plan = planNextRetry({
        roundsFailed: attempts,
        nowMs: settledAt.getTime(),
        windowExpiresAtMs: entry.windowExpiresAt.getTime(),
        ...(disposition.delayMs === undefined ? {} : { delayMs: disposition.delayMs }),
        ...(deps.random === undefined ? {} : { random: deps.random }),
      });
      if (plan.kind === "retry") {
        await deps.queue.reschedule(
          key,
          {
            attempts,
            nextRetryAt: new Date(plan.atMs),
            lastError: storableError(disposition.error),
          },
          settledAt,
        );
        if (disposition.countsAsFailure) {
          await recordSettlement(
            runtime,
            record,
            history,
            "retrying",
            attemptsOf(result, history, settledAt),
            undefined,
            settledAt,
          );
        }
        return "rescheduled";
      }
      await deadLetterAndSettle(deps, runtime, {
        entry,
        record,
        history,
        destination,
        envelope,
        reason: `window_closed: ${storableError(disposition.error)}`,
        error: disposition.error,
        now: settledAt,
        result,
      });
      return "dead_lettered";
    }
  }
}

/** The history entry's attempts grown by what this sweep did, numbered after the ones already there. */
function attemptsOf(
  result: DeliveryResult,
  history: DestinationHistoryEntry,
  at: Date,
): readonly RetryHistoryEntry[] {
  const offset = history.attempts.length;
  return buildRetryHistory(result, at.toISOString()).map((attempt) => ({
    ...attempt,
    attempt: attempt.attempt + offset,
  }));
}

async function deadLetterAndSettle(
  deps: RetrySweepDeps,
  runtime: RetryTenantRuntime,
  input: {
    readonly entry: DeliveryRetryEntry;
    readonly record: EventRecord;
    readonly history: DestinationHistoryEntry;
    readonly destination: DestinationDefinition;
    readonly envelope: EnrichedEnvelope;
    readonly reason: string;
    readonly error: string;
    readonly now: Date;
    readonly result?: DeliveryResult;
  },
): Promise<void> {
  const key = {
    tenantId: input.entry.tenantId,
    eventId: input.entry.eventId,
    destination: input.entry.destination,
  };
  // The platform dead-letter row keeps the payload, so an operator can still recover it by hand.
  await deadLetterDelivery(runtime.delivery.deadLetters, {
    envelope: input.envelope,
    destination: input.entry.destination,
    payload: input.history.renderedPayload,
    attempts: input.entry.attempts,
    error: storableError(input.error),
    failedAt: input.now.toISOString(),
  });
  await deps.queue.markDeadLettered(key, storableError(input.reason), input.now);
  await recordSettlement(
    runtime,
    input.record,
    input.history,
    "dead_lettered",
    input.result === undefined ? [] : attemptsOf(input.result, input.history, input.now),
    input.reason,
    input.now,
  );
}

/**
 * Appends the outcome to the event's record as a new revision. A failure here is swallowed: the queue
 * row is already settled, and failing the whole entry would leave it leased and due again — a second
 * send of something the vendor just accepted — to repair a bookkeeping line.
 */
async function recordSettlement(
  runtime: RetryTenantRuntime,
  record: EventRecord,
  history: DestinationHistoryEntry,
  status: "delivered" | "dead_lettered" | "retrying",
  newAttempts: readonly RetryHistoryEntry[],
  detail: string | undefined,
  at: Date,
): Promise<void> {
  const iso = at.toISOString();
  const updated: DestinationHistoryEntry = {
    ...history,
    status,
    attempts: [...history.attempts, ...newAttempts],
    lastAttemptAt: iso,
  };
  const all = record.destinationHistory.map((item) =>
    item.destination === history.destination ? updated : item,
  );
  const stage: StageHistoryEntry = {
    stage: "retry",
    status: status === "delivered" ? "completed" : "failed",
    at: iso,
    detail:
      detail === undefined ? `durable retry: ${status}` : `durable retry: ${storableError(detail)}`,
  };
  try {
    await runtime.records.appendHistory({
      eventId: record.eventId,
      tenantId: record.tenantId,
      stages: [stage],
      destinations: [updated],
      state: deriveEventState(all),
      at: iso,
    });
  } catch {
    // See above: bookkeeping must not undo a settled delivery.
  }
}
