import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import { toSnapshot } from "../domain/attribute-snapshot";
import { INITIAL_ATTRIBUTE_VERSION } from "../domain/attribute-version";
import { AttributeCreated } from "../events/attribute-created.event";
import { AttributeUpdated } from "../events/attribute-updated.event";
import type { AttributeEvaluationResult } from "../ports/attribute-evaluation";
import type { AttributeHistoryStore } from "../ports/attribute-history-store";
import type { AttributeStore } from "../ports/attribute-store";
import type { IdentifierRef } from "../ports/identity-decision";

export interface UpdateComputedAttributeProjectionInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  /** The output of `EvaluateComputedAttribute`/`EvaluateAttributeGraph` — this use case never
   * evaluates a rule set itself, only persists an already-evaluated result. */
  readonly result: AttributeEvaluationResult;
}

export interface UpdateComputedAttributeProjectionOutput {
  /** `false` when the evaluated value is unchanged from what is already on file (see
   * `applyAttributeUpdate`'s no-op guard) or when the evaluation produced no value at all (no rule
   * matched and the rule set has no `fallback`) — neither is an error, both are normal outcomes a
   * caller must not treat as a write having happened. `RecalculateComputedAttributes` reads this
   * flag directly to decide whether this attribute's own dependents are worth recomputing. */
  readonly applied: boolean;
  readonly version: number;
}

export interface UpdateComputedAttributeProjectionDeps {
  readonly attributes: AttributeStore;
  readonly history: AttributeHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Persists one already-evaluated {@link AttributeEvaluationResult} — the only write path into the
 * Computed Attributes projection, exactly mirroring `UpdateProfileProjection`'s role for the Profile
 * Engine. Appends a snapshot to the durable history and refreshes the current-view cache in one unit
 * of work, then publishes `AttributeCreated` (first attribute ever for this identifier) or
 * `AttributeUpdated` (an existing attribute set gained a real change) — never both, never neither,
 * for an applied update; publishes nothing at all when the update was a no-op.
 *
 * **Optimistic concurrency (ADR-0060).** The cache write is compare-and-swap: `attributes.
 * saveCurrent` is called with `base.version` — the version this call read `current` at — as the
 * expected version, so two concurrent evaluations for the same identifier can no longer silently
 * clobber each other (Phase 6.4.1 hardening, finding F2). The guarded write runs *before* the
 * history-ledger append, deliberately: if the cache write loses the race, it throws
 * `ConcurrencyError` and this method's promise rejects before any snapshot or event is recorded — a
 * losing call leaves no trace at all, not an orphaned history row with no corresponding cache state.
 * This is a deliberate rejection (a thrown, retryable `DomainError`), not a `Result.err` — matching
 * every other caller of a CAS-guarded `save()` on this platform (none of them catch
 * `ConcurrencyError`; see ADR-0060 Decision 4). A caller that wants to retry must re-read and
 * re-evaluate from scratch, not resume this call.
 */
export class UpdateComputedAttributeProjection implements UseCase<
  UpdateComputedAttributeProjectionInput,
  UpdateComputedAttributeProjectionOutput,
  DomainError
> {
  private readonly deps: UpdateComputedAttributeProjectionDeps;

  constructor(deps: UpdateComputedAttributeProjectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateComputedAttributeProjectionInput,
  ): Promise<Result<UpdateComputedAttributeProjectionOutput, DomainError>> {
    const current = await this.deps.attributes.getCurrent(input.identifier, input.tenantId);

    if (input.result.value === undefined) {
      return ok({ applied: false, version: current?.version ?? INITIAL_ATTRIBUTE_VERSION });
    }

    const wasNew = current === null;
    const base =
      current ??
      createEmptyComputedAttribute(
        input.identifier.type,
        input.identifier.value,
        input.result.evaluatedAt,
      );

    const applyResult = applyAttributeUpdate(base, input.result.definitionId, {
      value: input.result.value,
      definitionId: input.result.definitionId,
      definitionVersion: input.result.definitionVersion,
      matchedRuleIds: input.result.matchedRuleIds,
      inputs: input.result.inputs,
      evaluatedAt: input.result.evaluatedAt,
    });

    if (!applyResult.applied) {
      return ok({ applied: false, version: base.version });
    }

    return this.deps.unitOfWork.run<Result<UpdateComputedAttributeProjectionOutput, DomainError>>(
      async (tx) => {
        const occurredAt = this.deps.clock.now();
        const snapshot = toSnapshot(
          applyResult.attribute,
          wasNew ? "created" : "updated",
          occurredAt.toISOString(),
        );

        const eventData = {
          identifierType: input.identifier.type,
          identifierValue: input.identifier.value,
          attribute: input.result.definitionId,
          definitionId: input.result.definitionId,
          definitionVersion: input.result.definitionVersion,
          version: applyResult.attribute.version,
        };
        const event = wasNew
          ? new AttributeCreated(
              {
                eventId: this.deps.idGenerator.generate(),
                aggregateId: UniqueEntityId.from(input.identifier.value),
                occurredAt,
              },
              eventData,
            )
          : new AttributeUpdated(
              {
                eventId: this.deps.idGenerator.generate(),
                aggregateId: UniqueEntityId.from(input.identifier.value),
                occurredAt,
              },
              eventData,
            );

        // CAS write first (ADR-0060): on a lost race this throws `ConcurrencyError` here, before
        // the history append below ever runs — no orphaned snapshot, no partial effect.
        await this.deps.attributes.saveCurrent(
          applyResult.attribute,
          input.tenantId,
          base.version,
          tx,
        );
        await this.deps.history.append(snapshot, input.tenantId, event, tx);

        return ok({ applied: true, version: applyResult.attribute.version });
      },
    );
  }
}
