import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { type IdentifierType, resolveIdentity } from "@platform/tracking";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { IdentityCluster } from "../ports/identity-cluster";
import { toIdentityCluster } from "../ports/identity-cluster";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";
import type { IdentityGraphStore } from "../ports/identity-graph-store";
import { excludeRetractedEdges } from "../ports/identity-resolution";

export interface ResolveIdentityInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly type: IdentifierType;
  readonly value: string;
}

export interface ResolveIdentityOutput {
  /** `null` when the identifier has never been observed — not an error, just nothing to resolve. */
  readonly cluster: IdentityCluster | null;
}

export interface ResolveIdentityDeps {
  readonly graph: IdentityGraphStore;
  readonly decisions: IdentityDecisionStore;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Resolves the identity cluster reachable from a seed identifier, over the durable graph with
 * every split-retracted edge excluded. Delegates traversal + confidence scoring entirely to
 * `@platform/tracking`'s `resolveIdentity` (FF-CDP-04: computed attributes/resolution must be
 * deterministic — reusing the one implementation is how that holds).
 */
export class ResolveIdentity implements UseCase<
  ResolveIdentityInput,
  ResolveIdentityOutput,
  DomainError
> {
  private readonly deps: ResolveIdentityDeps;

  constructor(deps: ResolveIdentityDeps) {
    this.deps = deps;
  }

  async execute(input: ResolveIdentityInput): Promise<Result<ResolveIdentityOutput, DomainError>> {
    const [graph, retracted] = await Promise.all([
      this.deps.graph.loadGraph(input.tenantId),
      this.deps.decisions.retractedEdges(input.tenantId),
    ]);
    const view = excludeRetractedEdges(graph, retracted);
    const resolved = resolveIdentity(view, input.type, input.value);

    if (resolved === undefined) {
      return ok({ cluster: null });
    }

    const cluster = toIdentityCluster(
      this.deps.idGenerator.generate(),
      this.deps.clock.now().toISOString(),
      resolved,
    );
    return ok({ cluster });
  }
}
