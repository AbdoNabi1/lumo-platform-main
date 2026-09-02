import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SessionStore } from "../ports/session-store";
import type { RebuildSessions } from "./rebuild-sessions.use-case";

export type SessionProjectionWorkerInput = Record<string, never>;

export interface SessionProjectionWorkerOutput {
  readonly rebuilt: number;
  readonly failed: number;
}

export interface SessionProjectionWorkerDeps {
  readonly sessions: SessionStore;
  readonly rebuild: RebuildSessions;
}

/**
 * Batch-rebuilds every known session's current-view cache from history — the scheduled-job shape of
 * `RebuildSessions`, mirroring `ProfileProjectionWorker` exactly (same package, same convention;
 * same deferral of actual interval-job registration to `apps/runtime`'s own job list — see that
 * class's doc for why a service package must never depend on an app-layer scheduling type). One
 * session's failure never aborts the batch.
 */
export class SessionProjectionWorker implements UseCase<
  SessionProjectionWorkerInput,
  SessionProjectionWorkerOutput,
  DomainError
> {
  private readonly deps: SessionProjectionWorkerDeps;

  constructor(deps: SessionProjectionWorkerDeps) {
    this.deps = deps;
  }

  async execute(
    _input: SessionProjectionWorkerInput,
  ): Promise<Result<SessionProjectionWorkerOutput, DomainError>> {
    const sessionIds = await this.deps.sessions.listSessionIds();
    let rebuilt = 0;
    let failed = 0;

    for (const sessionId of sessionIds) {
      try {
        const result = await this.deps.rebuild.execute({ sessionId });
        if (result.ok) rebuilt += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    return ok({ rebuilt, failed });
  }
}
