import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { AttributeStore } from "../ports/attribute-store";
import type { RebuildComputedAttributes } from "./rebuild-computed-attributes.use-case";

export type ComputedAttributeProjectionWorkerInput = Record<string, never>;

export interface ComputedAttributeProjectionWorkerOutput {
  readonly rebuilt: number;
  readonly failed: number;
}

export interface ComputedAttributeProjectionWorkerDeps {
  readonly attributes: AttributeStore;
  readonly rebuild: RebuildComputedAttributes;
}

/**
 * Batch-rebuilds every known identifier's current-view cache from history — the scheduled-job shape
 * of `RebuildComputedAttributes`, exactly mirroring `ProfileProjectionWorker`/
 * `SessionProjectionWorker`. Deliberately plain (`execute()`, no dependency on `apps/runtime`'s
 * `ScheduledJob` type — a service package must never import an app-layer type); registering this as
 * an actual interval job belongs in `apps/runtime`'s own job list, deferred at the same maturity
 * level the other two engines' own production wiring already is.
 *
 * One identifier's failure never aborts the batch — each rebuild is isolated so one bad row cannot
 * block every other customer's computed attributes from refreshing.
 */
export class ComputedAttributeProjectionWorker implements UseCase<
  ComputedAttributeProjectionWorkerInput,
  ComputedAttributeProjectionWorkerOutput,
  DomainError
> {
  private readonly deps: ComputedAttributeProjectionWorkerDeps;

  constructor(deps: ComputedAttributeProjectionWorkerDeps) {
    this.deps = deps;
  }

  async execute(
    _input: ComputedAttributeProjectionWorkerInput,
  ): Promise<Result<ComputedAttributeProjectionWorkerOutput, DomainError>> {
    const identifiers = await this.deps.attributes.listIdentifiers();
    let rebuilt = 0;
    let failed = 0;

    for (const identifier of identifiers) {
      try {
        const result = await this.deps.rebuild.execute({ identifier });
        if (result.ok) rebuilt += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    return ok({ rebuilt, failed });
  }
}
