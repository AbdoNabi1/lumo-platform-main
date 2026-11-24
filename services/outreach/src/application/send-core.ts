import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { nextStatus, type OutboundStatus } from "../domain/outbound-message";
import type {
  OutboundChannel,
  OutboundKind,
  OutboundPurpose,
  OutboundRecord,
} from "../domain/repositories";
import { GENERIC_ERROR_CODE, safeCode } from "./error-codes";
import { type SendResultDto, sendResultDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import type { SendOutcome } from "./ports";
import { drainUnmatched, emitStatusChanged } from "./status-support";
import { conflict } from "./support";

/** What the channel-specific `decide` hands to the shared algorithm once it is allowed to reserve. */
export interface ReserveGo {
  contactId: string | null;
  suppressed: boolean;
  base: {
    channel: OutboundChannel;
    kind: OutboundKind;
    recipient: string;
    templateName: string | null;
    templateLanguage: string | null;
    templateRevision: number | null;
    purpose: OutboundPurpose;
    payload: unknown;
    contextRef: string | null;
    dispatchPhoneNumberId: string | null;
    dispatchWabaId: string | null;
  };
}

export type FinalCheck =
  | { ok: true; send: () => Promise<SendOutcome> }
  | { ok: false; code: "AUTHORIZATION_EXPIRED" | "CREDENTIALS_UNAVAILABLE" };

export interface SendSpec {
  tenantId: string;
  idempotencyKey: string;
  /** Runs inside the reservation transaction, after the replay check. A refusal writes nothing. */
  decide(tx: unknown): Promise<{ refuse: DomainError } | ReserveGo>;
  /**
   * Runs immediately before the provider call, EVERY time (no time threshold), against fresh state. A change racing in
   * AFTER this check cannot cancel an in-flight send: the provider call is not transactional with local state.
   */
  finalCheck(record: OutboundRecord): Promise<FinalCheck>;
  /** Email only: the slot is claimed by the creator of the row, in the same transaction as the insert. */
  emailCaps?: { perHour: number; perDay: number };
}

type Outcome = SendOutcome | { kind: "local_failure"; code: string };

class RolledBackRefusal extends Error {
  constructor(readonly refusal: DomainError) {
    super(refusal.message);
  }
}

type Reserved = { error: DomainError } | { record: OutboundRecord; created: boolean };

const SETTLE_ATTEMPTS = 3;

/**
 * The shared send algorithm (reserve → final check → dispatch → settle → drain), used by the WhatsApp template, the
 * WhatsApp session and the email send. The commit of the reservation is the authorization point; once it commits, the
 * row is the single source of truth and a replay of the same key never dispatches again.
 */
export async function runSend(
  deps: OutreachDeps,
  spec: SendSpec,
): Promise<Result<SendResultDto, DomainError>> {
  let reserved: Reserved;
  try {
    reserved = await deps.unitOfWork.run(spec.tenantId, (tx) => reserve(deps, spec, tx));
  } catch (error) {
    if (error instanceof RolledBackRefusal) return err(error.refusal);
    throw error;
  }
  if ("error" in reserved) {
    // A same-key sender may have won the reservation while this refusal was being decided: that key is answered by
    // the stored row, never by a refusal (and never by a second dispatch).
    const winner = await deps.outbound.findByIdempotencyKey(spec.tenantId, spec.idempotencyKey);
    return winner === null ? err(reserved.error) : ok(sendResultDto(winner));
  }
  const { record, created } = reserved;
  if (!created || record.status !== "pending") return ok(sendResultDto(record));

  const check = await spec.finalCheck(record);
  if (!check.ok) {
    const settled = await settle(deps, record, { kind: "local_failure", code: check.code });
    return settled.ok ? err(conflict(check.code)) : settled;
  }
  let outcome: Outcome;
  try {
    outcome = await check.send();
  } catch {
    // The call may or may not have reached the provider: the outcome is unknown, never retried.
    outcome = { kind: "unknown", message: "dispatch threw" };
  }
  return settle(deps, record, outcome);
}

async function reserve(deps: OutreachDeps, spec: SendSpec, tx: unknown): Promise<Reserved> {
  const existing = await deps.outbound.findByIdempotencyKey(spec.tenantId, spec.idempotencyKey, tx);
  if (existing !== null) return { record: existing, created: false };

  const decision = await spec.decide(tx);
  if ("refuse" in decision) return { error: decision.refuse };

  const now = deps.clock.now();
  const id = deps.idGenerator.generate();
  const { base } = decision;
  const record: OutboundRecord = {
    id,
    tenantId: spec.tenantId,
    channel: base.channel,
    kind: base.kind,
    contactId: decision.contactId,
    recipient: base.recipient,
    templateName: base.templateName,
    templateLanguage: base.templateLanguage,
    templateRevision: base.templateRevision,
    purpose: base.purpose,
    payload: base.payload,
    idempotencyKey: spec.idempotencyKey,
    status: decision.suppressed ? "suppressed" : "pending",
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    contextRef: base.contextRef,
    acceptedAt: null,
    correlationId: deps.idGenerator.generate(),
    dispatchStartedAt: decision.suppressed ? null : now,
    providerIdempotencyKey: base.channel === "email" ? `outreach/email/${id}` : null,
    dispatchPhoneNumberId: base.dispatchPhoneNumberId,
    dispatchWabaId: base.dispatchWabaId,
    version: 1,
  };
  // A losing concurrent insert returns the winner and consumes no slot.
  if ((await deps.outbound.insert(record, tx)) === "duplicate") {
    const winner = await deps.outbound.findByIdempotencyKey(spec.tenantId, spec.idempotencyKey, tx);
    if (winner === null) throw new Error("duplicate idempotency key without a stored row");
    return { record: winner, created: false };
  }
  if (decision.suppressed) {
    await emitStatusChanged(deps, tx, record, "pending", null);
    return { record, created: true };
  }
  if (spec.emailCaps !== undefined) {
    const slot = await deps.emailCounters.reserve(spec.tenantId, now, spec.emailCaps, tx);
    // Throwing rolls the whole reservation back, including the insert above.
    if (slot !== "reserved") throw new RolledBackRefusal(conflict("EMAIL_CAP_REACHED"));
  }
  return { record, created: true };
}

/**
 * Records the dispatch outcome: reread, merge through the state machine, CAS-retry (local writes only, never a second
 * provider call). If it cannot be recorded the row stays `pending` with `dispatchStartedAt` set; it is NEVER
 * re-dispatched and the recovery job later marks it `unknown`.
 */
async function settle(
  deps: OutreachDeps,
  reserved: OutboundRecord,
  outcome: Outcome,
): Promise<Result<SendResultDto, DomainError>> {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    try {
      const stored = await deps.unitOfWork.run(reserved.tenantId, (tx) =>
        settleOnce(deps, tx, reserved, outcome),
      );
      return ok(sendResultDto(stored));
    } catch {
      // retried below; after the last attempt the outcome is reported as unrecorded
    }
  }
  return err(conflict("SEND_OUTCOME_UNRECORDED"));
}

async function settleOnce(
  deps: OutreachDeps,
  tx: unknown,
  reserved: OutboundRecord,
  outcome: Outcome,
): Promise<OutboundRecord> {
  // The accepted settlement installs the provider id and drains earlier facts: it takes the same transaction-scoped
  // key as a webhook's lookup/put (and bind/drain), BEFORE it reads anything, so neither can slip between the other's
  // read and write.
  if (
    outcome.kind === "accepted" &&
    reserved.channel === "whatsapp" &&
    reserved.dispatchPhoneNumberId !== null
  ) {
    await deps.unmatched.lockMessage(
      reserved.tenantId,
      reserved.dispatchPhoneNumberId,
      outcome.providerMessageId,
      tx,
    );
  }
  const row = await deps.outbound.findById(reserved.tenantId, reserved.id, tx);
  if (row === null) throw new Error("outbound row vanished");
  const now = deps.clock.now();

  let incoming: OutboundStatus;
  let providerMessageId = row.providerMessageId;
  let acceptedAt = row.acceptedAt;
  let errorCode = row.errorCode;
  switch (outcome.kind) {
    case "accepted":
      incoming = "accepted";
      providerMessageId = providerMessageId ?? outcome.providerMessageId;
      acceptedAt = acceptedAt ?? now;
      break;
    case "rejected":
      incoming = "failed";
      errorCode = safeCode(outcome.code) ?? GENERIC_ERROR_CODE;
      break;
    case "local_failure":
      incoming = "failed";
      errorCode = safeCode(outcome.code) ?? GENERIC_ERROR_CODE;
      break;
    default:
      incoming = "unknown";
  }
  const status = nextStatus(row.status, incoming);
  let current = row;
  const changed =
    status !== row.status ||
    providerMessageId !== row.providerMessageId ||
    acceptedAt?.getTime() !== row.acceptedAt?.getTime() ||
    (status === "failed" && errorCode !== row.errorCode);
  if (changed) {
    const next: OutboundRecord = {
      ...row,
      status,
      providerMessageId,
      acceptedAt,
      errorCode: status === "failed" ? errorCode : row.errorCode,
      version: row.version + 1,
    };
    await deps.outbound.update(next, row.version, tx);
    if (status !== row.status) {
      await emitStatusChanged(deps, tx, next, row.status, outcome.kind === "accepted" ? now : null);
    }
    current = next;
  }

  // Drain: statuses that arrived before the provider id was known are applied now (after their evidence is
  // re-verified), in this same transaction.
  if (outcome.kind === "accepted") current = await drainUnmatched(deps, tx, current);
  return current;
}
