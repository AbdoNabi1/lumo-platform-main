import { nextStatus, type OutboundStatus } from "../domain/outbound-message";
import type { OutboundRecord } from "../domain/repositories";
import { safeCode } from "./error-codes";
import type { OutreachDeps } from "./outreach-deps";
import { type EventDeps, emit } from "./support";

/** A verified delivery fact about one outbound message (from a webhook, or drained from the unmatched store). */
export interface StatusFact {
  providerMessageId: string | null;
  status: OutboundStatus;
  occurredAt: Date;
  providerEventId: string;
  errorCode: string | null;
}

const ACCEPTED_BY_PROVIDER: ReadonlySet<OutboundStatus> = new Set(["sent", "delivered", "read"]);

/**
 * Applies one fact to an outbound row inside `tx`: the dedup marker, the state change and the `status_changed` event
 * share the transaction. A duplicate fact (same provider event id) changes nothing. Stale facts (a lower rank than the
 * current status) install the provider id at most and emit nothing.
 *
 * `acceptedAt` is set once: from an accepted send response (the caller) or from the first verified sent/delivered/read
 * using that status's provider timestamp. `failed` never sets it.
 */
export async function applyStatusFact(
  deps: OutreachDeps,
  tx: unknown,
  row: OutboundRecord,
  fact: StatusFact,
): Promise<{ row: OutboundRecord; applied: boolean }> {
  const marker = await deps.outbound.recordStatusEvent(
    {
      id: deps.idGenerator.generate(),
      tenantId: row.tenantId,
      outboundMessageId: row.id,
      providerEventId: fact.providerEventId,
      status: fact.status,
      occurredAt: fact.occurredAt,
      // Allowlisted fields only: status, timestamp, error code. Never provider payloads or message text.
      raw: {
        status: fact.status,
        timestamp: fact.occurredAt.toISOString(),
        errorCode: safeCode(fact.errorCode),
      },
    },
    tx,
  );
  if (marker === "duplicate") return { row, applied: false };

  const status = nextStatus(row.status, fact.status);
  const providerMessageId = row.providerMessageId ?? fact.providerMessageId;
  const acceptedAt =
    row.acceptedAt ?? (ACCEPTED_BY_PROVIDER.has(fact.status) ? fact.occurredAt : null);
  const errorCode =
    fact.status === "failed" && status === "failed"
      ? (safeCode(fact.errorCode) ?? row.errorCode)
      : row.errorCode;

  const changed =
    status !== row.status ||
    providerMessageId !== row.providerMessageId ||
    acceptedAt?.getTime() !== row.acceptedAt?.getTime() ||
    errorCode !== row.errorCode;
  if (!changed) return { row, applied: true };

  const next: OutboundRecord = {
    ...row,
    status,
    providerMessageId,
    acceptedAt,
    errorCode,
    version: row.version + 1,
  };
  await deps.outbound.update(next, row.version, tx);
  if (status !== row.status) {
    await emitStatusChanged(deps, tx, next, row.status, fact.occurredAt);
  }
  return { row: next, applied: true };
}

export async function emitStatusChanged(
  deps: EventDeps,
  tx: unknown,
  row: OutboundRecord,
  from: OutboundStatus,
  providerOccurredAt: Date | null,
): Promise<void> {
  await emit(deps, tx, row.tenantId, "outreach.message.status_changed", row.id, {
    outboundId: row.id,
    channel: row.channel,
    from,
    to: row.status,
    providerMessageId: row.providerMessageId,
    providerOccurredAt: providerOccurredAt === null ? null : providerOccurredAt.toISOString(),
    contextRef: row.contextRef,
  });
}
