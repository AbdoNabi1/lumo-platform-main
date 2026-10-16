import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { fromSnapshot } from "../domain/profile-snapshot";
import type { CustomerProfile } from "../domain/customer-profile";
import { toSnapshot } from "../domain/profile-snapshot";
import { ProfileRebuilt } from "../events/profile-rebuilt.event";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileHistoryStore } from "../ports/profile-history-store";
import type { ProfileStore } from "../ports/profile-store";

export interface RebuildProfileProjectionInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
}

export interface RebuildProfileProjectionOutput {
  /** `null` when the identifier has no history at all — not an error, just nothing to rebuild
   * (mirrors `ResolveIdentity`'s "never observed" `null`, not an error path). */
  readonly profile: CustomerProfile | null;
  readonly fieldCount: number;
}

export interface RebuildProfileProjectionDeps {
  readonly profiles: ProfileStore;
  readonly history: ProfileHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Recomputes the current-view cache (`ProfileStore`) from the durable history ledger — the recovery
 * path 03-CUSTOMER_360_SPEC.md §15 promises ("Projection is rebuildable by event replay"). Because
 * every {@link ProfileSnapshot} already captures the *full* field set as of its version (not a diff),
 * "replay" here is simply "read the latest snapshot" — there is no fold/reduce over history required,
 * which is the whole reason snapshots are captured full rather than incrementally.
 */
export class RebuildProfileProjection implements UseCase<
  RebuildProfileProjectionInput,
  RebuildProfileProjectionOutput,
  DomainError
> {
  private readonly deps: RebuildProfileProjectionDeps;

  constructor(deps: RebuildProfileProjectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: RebuildProfileProjectionInput,
  ): Promise<Result<RebuildProfileProjectionOutput, DomainError>> {
    const latest = await this.deps.history.latestFor(input.identifier, input.tenantId);
    if (latest === null) {
      return ok({ profile: null, fieldCount: 0 });
    }

    const rebuilt = fromSnapshot(latest);

    return this.deps.unitOfWork.run<Result<RebuildProfileProjectionOutput, DomainError>>(
      async (tx) => {
        const occurredAt = this.deps.clock.now();
        // Same version as `latest` — a rebuild recomputes the cache, it does not assert a new fact, so
        // it must never inflate the change counter. A fresh `capturedAt` + `reason: "rebuilt"` still
        // gives the history ledger an honest audit trail of when recovery ran.
        const snapshot = toSnapshot(rebuilt, "rebuilt", occurredAt.toISOString());

        const event = new ProfileRebuilt(
          {
            eventId: this.deps.idGenerator.generate(),
            aggregateId: UniqueEntityId.from(input.identifier.value),
            occurredAt,
          },
          {
            identifierType: input.identifier.type,
            identifierValue: input.identifier.value,
            fieldCount: rebuilt.fields.size,
            version: rebuilt.version,
          },
        );

        await this.deps.history.append(snapshot, event, input.tenantId, tx);
        await this.deps.profiles.saveCurrent(rebuilt, input.tenantId, tx);

        return ok({ profile: rebuilt, fieldCount: rebuilt.fields.size });
      },
    );
  }
}
