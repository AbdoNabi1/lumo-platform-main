import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { ProfileStore } from "../ports/profile-store";
import type { RebuildProfileProjection } from "./rebuild-profile-projection.use-case";

export type ProfileProjectionWorkerInput = Record<string, never>;

export interface ProfileProjectionWorkerOutput {
  readonly rebuilt: number;
  readonly failed: number;
}

export interface ProfileProjectionWorkerDeps {
  readonly profiles: ProfileStore;
  readonly rebuild: RebuildProfileProjection;
}

/**
 * Batch-rebuilds every known profile's current-view cache from history — the scheduled-job shape of
 * `RebuildProfileProjection`. Deliberately plain (`run()`/`execute()`, no dependency on
 * `apps/runtime`'s `ScheduledJob` type): a service package must never import an app-layer type
 * (wrong dependency direction, `no-cross-service-internals`-style boundary), so registering this as
 * an actual interval job belongs in `apps/runtime`'s own job list, adapting this class's `execute()`
 * to its `ScheduledJob.run()` shape — matching exactly how Identity Engine's production Prisma wiring
 * is deferred to its own future composition step (see the Phase 6.1 audit, §13.1). Not wired here;
 * see the Phase 6.2 report's deferred-work section.
 *
 * One identifier's failure never aborts the batch — each rebuild is isolated so one bad row cannot
 * block every other customer's profile from refreshing.
 */
export class ProfileProjectionWorker implements UseCase<
  ProfileProjectionWorkerInput,
  ProfileProjectionWorkerOutput,
  DomainError
> {
  private readonly deps: ProfileProjectionWorkerDeps;

  constructor(deps: ProfileProjectionWorkerDeps) {
    this.deps = deps;
  }

  async execute(
    _input: ProfileProjectionWorkerInput,
  ): Promise<Result<ProfileProjectionWorkerOutput, DomainError>> {
    const identifiers = await this.deps.profiles.listIdentifiers();
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
