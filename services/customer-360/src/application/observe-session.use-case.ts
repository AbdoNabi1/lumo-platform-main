import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import {
  closeSession,
  openSession,
  recordActivity,
  type CustomerSession,
} from "../domain/customer-session";
import { toSnapshot } from "../domain/session-snapshot";
import { DEFAULT_SESSION_TIMEOUT_MS, withinSessionWindow } from "../domain/session-window";
import { SessionClosed } from "../events/session-closed.event";
import { SessionStarted } from "../events/session-started.event";
import { SessionUpdated } from "../events/session-updated.event";
import type { JourneyStore } from "../ports/journey-store";
import type { SessionHistoryStore } from "../ports/session-history-store";
import type { SessionStore } from "../ports/session-store";

export interface ObserveSessionInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly deviceId?: string;
  readonly journeyId?: string;
  readonly source?: string;
  /** ISO-8601 UTC instant the activity occurred (client-asserted, e.g. a `TrackingEnvelope`'s own
   * `timestamp`) — drives session state directly, distinct from `Clock.now()` (used only for
   * snapshot/event bookkeeping), same split `UpdateProfileProjection` already makes. */
  readonly occurredAt: string;
  readonly timeoutMs?: number;
  /** Whether this activity carries a known-identity signal — the caller's own
   * `isKnownIdentity(identity)` result (`@platform/tracking`'s `IdentityContext`), passed in rather
   * than re-derived here (never duplicate Identity Graph logic). The first time this is `true` for a
   * visitor, `ObserveSession` records an `anonymous_to_identified` transition (Rules: "Support:
   * anonymous → identified"); every later call is a no-op on this front (already identified). */
  readonly identified?: boolean;
}

export interface ObserveSessionOutput {
  readonly sessionId: string;
  /** `true` when this call started a brand-new session (first-ever activity for `sessionId`, a
   * closed `sessionId` reappearing, or a timeout rollover) rather than folding activity into an
   * already-open one. */
  readonly opened: boolean;
  /** Present only on a timeout rollover — the session that was just closed with
   * `closeReason: "timeout"` before this one was opened. */
  readonly rolledOverFrom?: string;
}

export interface ObserveSessionDeps {
  readonly sessions: SessionStore;
  readonly history: SessionHistoryStore;
  readonly journey: JourneyStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Ingests one observed activity (typically one `TrackingEnvelope`'s session context) and folds it
 * into the right session: starts a new one if `sessionId` has never been seen or was previously
 * closed (a closed session is never reopened — append-only), folds activity into the existing open
 * session if still within its idle window (`withinSessionWindow`), or rolls over into a *new*
 * session — closing the old one with `closeReason: "timeout"` and chaining a `timed_out` transition
 * — once the idle gap is exceeded. This is the workhorse ingestion path, the session-side
 * counterpart to `ObserveIdentityLink`, and never touches the Identity Graph.
 *
 * Session timeout is handled **lazily**, on the next observed activity — there is no background
 * sweep that proactively closes idle sessions (an explicitly deferred scope decision; see
 * `docs/platform/SESSION_MODEL.md`).
 */
export class ObserveSession implements UseCase<
  ObserveSessionInput,
  ObserveSessionOutput,
  DomainError
> {
  private readonly deps: ObserveSessionDeps;

  constructor(deps: ObserveSessionDeps) {
    this.deps = deps;
  }

  async execute(input: ObserveSessionInput): Promise<Result<ObserveSessionOutput, DomainError>> {
    if (input.sessionId.trim() === "" || input.visitorId.trim() === "") {
      return err(
        new ValidationError("Observing a session requires a sessionId and visitorId", [
          { field: "sessionId", message: "required" },
        ]),
      );
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    const existing = await this.deps.sessions.getCurrent(input.sessionId, input.tenantId);

    if (
      existing !== null &&
      existing.status === "open" &&
      withinSessionWindow(existing.lastActivityAt, input.occurredAt, timeoutMs)
    ) {
      return this.deps.unitOfWork.run<Result<ObserveSessionOutput, DomainError>>(async (tx) => {
        const result = recordActivity(existing, input.occurredAt);
        if (result.applied) {
          await this.persistUpdate(result.session, input.tenantId, tx);
        }
        if (input.identified === true) {
          await this.maybeRecordIdentified(
            input.tenantId,
            input.visitorId,
            input.sessionId,
            input.occurredAt,
            tx,
          );
        }
        return ok({ sessionId: input.sessionId, opened: false });
      });
    }

    return this.deps.unitOfWork.run<Result<ObserveSessionOutput, DomainError>>(async (tx) => {
      let rolledOverFrom: string | undefined;

      // A rollover is not necessarily the *same* sessionId reappearing — the common case is the
      // tracking SDK minting a fresh session_id once its own client-side timeout fires, so the
      // visitor's other still-open session(s) must be checked by visitor, not by the incoming id.
      const openForVisitor = await this.deps.sessions.listOpenForVisitor(
        input.visitorId,
        input.tenantId,
      );
      for (const stale of openForVisitor) {
        if (withinSessionWindow(stale.lastActivityAt, input.occurredAt, timeoutMs)) continue;

        const closed = closeSession(stale, "timeout", input.occurredAt);
        await this.persistClose(closed, input.tenantId, tx);
        await this.deps.journey.record(
          {
            id: this.deps.idGenerator.generate(),
            kind: "timed_out",
            visitorId: stale.visitorId,
            fromSessionId: stale.sessionId,
            toSessionId: input.sessionId,
            occurredAt: input.occurredAt,
          },
          input.tenantId,
          undefined,
          tx,
        );
        rolledOverFrom = stale.sessionId;
      }

      const session = openSession({
        sessionId: input.sessionId,
        visitorId: input.visitorId,
        deviceId: input.deviceId,
        journeyId: input.journeyId,
        source: input.source,
        startedAt: input.occurredAt,
      });
      await this.persistStart(session, input.tenantId, tx);
      if (input.identified === true) {
        await this.maybeRecordIdentified(
          input.tenantId,
          input.visitorId,
          input.sessionId,
          input.occurredAt,
          tx,
        );
      }

      return ok({ sessionId: session.sessionId, opened: true, rolledOverFrom });
    });
  }

  /** Records `anonymous_to_identified` at most once per visitor — checks the journey's own history
   * rather than tracking a separate flag, so the guarantee holds even across process restarts (no
   * in-memory-only state to lose). */
  private async maybeRecordIdentified(
    tenantId: string,
    visitorId: string,
    sessionId: string,
    occurredAt: string,
    tx: unknown,
  ): Promise<void> {
    const transitions = await this.deps.journey.listForVisitor(visitorId, tenantId);
    if (transitions.some((t) => t.kind === "anonymous_to_identified")) return;

    await this.deps.journey.record(
      {
        id: this.deps.idGenerator.generate(),
        kind: "anonymous_to_identified",
        visitorId,
        fromSessionId: sessionId,
        occurredAt,
      },
      tenantId,
      undefined,
      tx,
    );
  }

  private async persistStart(
    session: CustomerSession,
    tenantId: string,
    tx: unknown,
  ): Promise<void> {
    const occurredAt = this.deps.clock.now();
    const snapshot = toSnapshot(session, "started", occurredAt.toISOString());
    const event = new SessionStarted(
      {
        eventId: this.deps.idGenerator.generate(),
        aggregateId: UniqueEntityId.from(session.sessionId),
        occurredAt,
      },
      {
        sessionId: session.sessionId,
        visitorId: session.visitorId,
        deviceId: session.deviceId,
        journeyId: session.journeyId,
        source: session.source,
      },
    );
    await this.deps.history.append(snapshot, tenantId, event, tx);
    await this.deps.sessions.saveCurrent(session, tenantId, tx);
  }

  private async persistUpdate(
    session: CustomerSession,
    tenantId: string,
    tx: unknown,
  ): Promise<void> {
    const occurredAt = this.deps.clock.now();
    const snapshot = toSnapshot(session, "activity", occurredAt.toISOString());
    const event = new SessionUpdated(
      {
        eventId: this.deps.idGenerator.generate(),
        aggregateId: UniqueEntityId.from(session.sessionId),
        occurredAt,
      },
      { sessionId: session.sessionId, pageCount: session.pageCount },
    );
    await this.deps.history.append(snapshot, tenantId, event, tx);
    await this.deps.sessions.saveCurrent(session, tenantId, tx);
  }

  private async persistClose(
    session: CustomerSession,
    tenantId: string,
    tx: unknown,
  ): Promise<void> {
    const occurredAt = this.deps.clock.now();
    const snapshot = toSnapshot(session, "closed", occurredAt.toISOString());
    const event = new SessionClosed(
      {
        eventId: this.deps.idGenerator.generate(),
        aggregateId: UniqueEntityId.from(session.sessionId),
        occurredAt,
      },
      {
        sessionId: session.sessionId,
        closeReason: session.closeReason ?? "timeout",
        pageCount: session.pageCount,
      },
    );
    await this.deps.history.append(snapshot, tenantId, event, tx);
    await this.deps.sessions.saveCurrent(session, tenantId, tx);
  }
}
