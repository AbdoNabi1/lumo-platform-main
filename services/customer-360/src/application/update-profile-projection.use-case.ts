import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { applyFieldUpdate, createEmptyProfile } from "../domain/customer-profile";
import type { ProfileFieldConfidence } from "../domain/profile-field";
import { toSnapshot } from "../domain/profile-snapshot";
import { ProfileCreated } from "../events/profile-created.event";
import { ProfileUpdated } from "../events/profile-updated.event";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileHistoryStore } from "../ports/profile-history-store";
import type { ProfileStore } from "../ports/profile-store";

export interface UpdateProfileProjectionInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  readonly field: string;
  readonly value: unknown;
  readonly source: string;
  readonly confidence: ProfileFieldConfidence;
  /** ISO-8601 UTC instant the asserting fact occurred — not necessarily "now" (the caller may be
   * relaying a delayed or replayed fact). */
  readonly occurredAt: string;
}

export interface UpdateProfileProjectionOutput {
  /** `false` when a fresher value was already on file and this update was correctly ignored (see
   * `applyFieldUpdate`'s freshness guard) — not an error, a normal outcome of at-least-once,
   * not-necessarily-ordered delivery. */
  readonly applied: boolean;
  readonly version: number;
}

export interface UpdateProfileProjectionDeps {
  readonly profiles: ProfileStore;
  readonly history: ProfileHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Asserts one field's value onto an identifier's profile — the only write path into the projection.
 * Deliberately generic over *what* produced the fact (field name + value + source + confidence +
 * occurredAt) rather than binding to any specific upstream event shape (Orders, Payments, ...): the
 * Profile Engine owns no source-of-truth fields and Phase 6.2 does not wire any specific upstream
 * consumer yet (that is future-phase integration work, not a speculative abstraction to pre-build
 * here). Appends a snapshot to the durable history and refreshes the current-view cache in one unit
 * of work, then publishes `ProfileCreated` (first field ever) or `ProfileUpdated` (existing profile)
 * — never both, never neither, for an applied update.
 */
export class UpdateProfileProjection implements UseCase<
  UpdateProfileProjectionInput,
  UpdateProfileProjectionOutput,
  DomainError
> {
  private readonly deps: UpdateProfileProjectionDeps;

  constructor(deps: UpdateProfileProjectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateProfileProjectionInput,
  ): Promise<Result<UpdateProfileProjectionOutput, DomainError>> {
    if (input.field.trim() === "" || input.source.trim() === "") {
      return err(
        new ValidationError("Profile field update requires a field name and a source", [
          { field: "field", message: "required" },
        ]),
      );
    }

    const current = await this.deps.profiles.getCurrent(input.identifier, input.tenantId);
    const wasNew = current === null;
    const base =
      current ??
      createEmptyProfile(input.identifier.type, input.identifier.value, input.occurredAt);

    const result = applyFieldUpdate(base, input.field, {
      value: input.value,
      source: input.source,
      confidence: input.confidence,
      occurredAt: input.occurredAt,
    });

    if (!result.applied) {
      return ok({ applied: false, version: base.version });
    }

    return this.deps.unitOfWork.run<Result<UpdateProfileProjectionOutput, DomainError>>(
      async (tx) => {
        const occurredAt = this.deps.clock.now();
        const snapshot = toSnapshot(
          result.profile,
          wasNew ? "created" : "updated",
          occurredAt.toISOString(),
        );

        const eventData = {
          identifierType: input.identifier.type,
          identifierValue: input.identifier.value,
          field: input.field,
          source: input.source,
          confidence: input.confidence,
          version: result.profile.version,
        };
        const event = wasNew
          ? new ProfileCreated(
              {
                eventId: this.deps.idGenerator.generate(),
                aggregateId: UniqueEntityId.from(input.identifier.value),
                occurredAt,
              },
              eventData,
            )
          : new ProfileUpdated(
              {
                eventId: this.deps.idGenerator.generate(),
                aggregateId: UniqueEntityId.from(input.identifier.value),
                occurredAt,
              },
              eventData,
            );

        await this.deps.history.append(snapshot, event, input.tenantId, tx);
        await this.deps.profiles.saveCurrent(result.profile, input.tenantId, tx);

        return ok({ applied: true, version: result.profile.version });
      },
    );
  }
}
