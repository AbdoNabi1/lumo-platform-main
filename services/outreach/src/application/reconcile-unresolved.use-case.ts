import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { OutreachDeps } from "./outreach-deps";
import type { EventDeps } from "./support";

/** The recovery job needs only the outbound repository, the unit of work, the clock and the event sink. */
export type ReconcileUnresolvedDeps = EventDeps &
  Pick<OutreachDeps, "outbound" | "unitOfWork" | "unresolvedAfterMs">;
import { emitStatusChanged } from "./status-support";

const BATCH = 100;
const MAX_BATCHES = 20;

/**
 * Recovery for sends whose outcome was never recorded (a crash after the reservation, or a failed settlement):
 * `pending` rows older than `unresolvedAfterMs` become `unknown`, with `status_changed` in the same transaction.
 * Tenant-scoped (the runtime enumerates tenants). It NEVER calls a provider and never re-dispatches.
 */
export class ReconcileUnresolvedOutbound implements UseCase<
  { tenantId: string },
  number,
  DomainError
> {
  constructor(private readonly deps: ReconcileUnresolvedDeps) {}

  async execute(input: { tenantId: string }): Promise<Result<number, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    let marked = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const olderThan = new Date(deps.clock.now().getTime() - deps.unresolvedAfterMs);
      // Listing and settlement both run in the tenant-scoped unit of work: under RLS a row discovered outside the
      // scope could not be matched (or would be invisible) when it is settled.
      const rows = await deps.unitOfWork.run(tenantId, (tx) =>
        deps.outbound.listUnresolved(tenantId, olderThan, BATCH, tx),
      );
      let progressed = 0;
      for (const candidate of rows) {
        const done = await deps.unitOfWork.run(tenantId, async (tx) => {
          const result = await deps.outbound.markUnknownIfPending(
            tenantId,
            candidate.id,
            candidate.version,
            tx,
          );
          if (result !== "marked") return false;
          const row = await deps.outbound.findById(tenantId, candidate.id, tx);
          if (row !== null) await emitStatusChanged(deps, tx, row, "pending", null);
          return true;
        });
        if (done) progressed += 1;
      }
      marked += progressed;
      if (rows.length < BATCH || progressed === 0) break;
    }
    return ok(marked);
  }
}
