import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { CustomerSession } from "../domain/customer-session";
import { fromSnapshot, toSnapshot } from "../domain/session-snapshot";
import type { SessionHistoryStore } from "../ports/session-history-store";
import type { SessionStore } from "../ports/session-store";

export interface RebuildSessionsInput {
  readonly sessionId: string;
}

export interface RebuildSessionsOutput {
  /** `null` when the session has no history at all — not an error, just nothing to rebuild
   * (mirrors `RebuildProfileProjection`'s own `null` for the same reason). */
  readonly session: CustomerSession | null;
}

export interface RebuildSessionsDeps {
  readonly sessions: SessionStore;
  readonly history: SessionHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Recomputes one session's current-view cache (`SessionStore`) from the durable history ledger —
 * the recovery path, same shape as `RebuildProfileProjection`. Every `SessionSnapshot` already
 * captures the *full* session state as of its version, so "replay" is simply "read the latest
 * snapshot" — no fold over history required. No event is published (see
 * `SessionHistoryStore.append`'s doc — Phase 6.3 has no `session.rebuilt` event type).
 */
export class RebuildSessions implements UseCase<
  RebuildSessionsInput,
  RebuildSessionsOutput,
  DomainError
> {
  private readonly deps: RebuildSessionsDeps;

  constructor(deps: RebuildSessionsDeps) {
    this.deps = deps;
  }

  async execute(input: RebuildSessionsInput): Promise<Result<RebuildSessionsOutput, DomainError>> {
    const latest = await this.deps.history.latestFor(input.sessionId);
    if (latest === null) {
      return ok({ session: null });
    }

    const rebuilt = fromSnapshot(latest);

    return this.deps.unitOfWork.run<Result<RebuildSessionsOutput, DomainError>>(async (tx) => {
      const occurredAt = this.deps.clock.now();
      const snapshot = toSnapshot(rebuilt, "rebuilt", occurredAt.toISOString());

      await this.deps.history.append(snapshot, undefined, tx);
      await this.deps.sessions.saveCurrent(rebuilt, tx);

      return ok({ session: rebuilt });
    });
  }
}
