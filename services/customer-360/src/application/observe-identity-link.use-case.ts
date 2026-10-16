import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import {
  EMPTY_IDENTITY_GRAPH,
  stitchFromIdentifiers,
  type IdentifierType,
} from "@platform/tracking";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { IdentityLinkObserved } from "../events/identity-link-observed.event";
import type { IdentityGraphStore } from "../ports/identity-graph-store";

export interface ObserveIdentityLinkInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly visitorId: string;
  readonly identifiers: readonly { readonly type: IdentifierType; readonly value: string }[];
  readonly observedAt: string;
  readonly source: string;
}

export interface ObserveIdentityLinkOutput {
  readonly edgesObserved: number;
}

export interface ObserveIdentityLinkDeps {
  readonly graph: IdentityGraphStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Persists one edge per non-empty identifier on the envelope's identity block, anchored to the
 * visitor. Delegates the actual stitching (which identifiers become edges, at what confidence) to
 * `@platform/tracking`'s pure `stitchFromIdentifiers` — the exact function the tracking pipeline
 * itself uses — so this never re-derives that logic; it only walks the resulting edges and persists
 * each one through the durable port instead of returning an in-memory graph.
 */
export class ObserveIdentityLink implements UseCase<
  ObserveIdentityLinkInput,
  ObserveIdentityLinkOutput,
  DomainError
> {
  private readonly deps: ObserveIdentityLinkDeps;

  constructor(deps: ObserveIdentityLinkDeps) {
    this.deps = deps;
  }

  async execute(
    input: ObserveIdentityLinkInput,
  ): Promise<Result<ObserveIdentityLinkOutput, DomainError>> {
    const stitched = stitchFromIdentifiers(EMPTY_IDENTITY_GRAPH, input);

    return this.deps.unitOfWork.run<Result<ObserveIdentityLinkOutput, DomainError>>(async (tx) => {
      for (const edge of stitched.edges) {
        const event = new IdentityLinkObserved(
          {
            eventId: this.deps.idGenerator.generate(),
            aggregateId: UniqueEntityId.from(input.visitorId),
            occurredAt: this.deps.clock.now(),
          },
          {
            fromType: edge.fromType,
            fromValue: edge.fromValue,
            toType: edge.toType,
            toValue: edge.toValue,
            confidence: edge.confidence,
            source: edge.source,
          },
        );
        await this.deps.graph.appendEdge(edge, input.tenantId, event, tx);
      }
      return ok({ edgesObserved: stitched.edges.length });
    });
  }
}
