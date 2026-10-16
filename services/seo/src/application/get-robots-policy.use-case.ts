import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { RobotsPolicyRepository } from "../domain/repositories";
import type { RobotsPolicy } from "../domain/robots-policy";

export interface PolicyIdInput {
  readonly policyId: string;
  readonly tenantId: string;
}

export interface GetRobotsPolicyDeps {
  readonly robotsPolicies: RobotsPolicyRepository;
}

/** Fetches a single robots policy by id. */
export class GetRobotsPolicy implements UseCase<PolicyIdInput, RobotsPolicy, DomainError> {
  private readonly deps: GetRobotsPolicyDeps;

  constructor(deps: GetRobotsPolicyDeps) {
    this.deps = deps;
  }

  async execute(input: PolicyIdInput): Promise<Result<RobotsPolicy, DomainError>> {
    const policy = await this.deps.robotsPolicies.findById(input.policyId, input.tenantId);
    return policy === null ? err(new NotFoundError("Robots policy not found")) : ok(policy);
  }
}
