import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { RobotsPolicyRepository } from "../domain/repositories";
import type { RobotsPolicy } from "../domain/robots-policy";

export interface ListRobotsPoliciesDeps {
  readonly robotsPolicies: RobotsPolicyRepository;
}

/** Cursor-paginated robots-policy listing. */
export class ListRobotsPolicies
  implements UseCase<CursorPage, Paginated<RobotsPolicy>, DomainError>
{
  private readonly deps: ListRobotsPoliciesDeps;

  constructor(deps: ListRobotsPoliciesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<RobotsPolicy>, DomainError>> {
    return ok(await this.deps.robotsPolicies.list(input));
  }
}
