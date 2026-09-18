import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { PricingRule, type PricingRuleType } from "../domain/pricing-rule";
import type { PricingRuleRepository } from "../domain/pricing-rule-repository";

export interface CreatePricingRuleInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly type: PricingRuleType;
  readonly value: number;
  readonly priority: number;
}

export interface CreatePricingRuleOutput {
  readonly id: string;
}

export interface CreatePricingRuleDeps {
  readonly pricingRules: PricingRuleRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a list-price adjustment rule. A `percentage` rule is capped at 100. Determination only — never applied at checkout. */
export class CreatePricingRule implements UseCase<
  CreatePricingRuleInput,
  CreatePricingRuleOutput,
  DomainError
> {
  private readonly deps: CreatePricingRuleDeps;

  constructor(deps: CreatePricingRuleDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreatePricingRuleInput,
  ): Promise<Result<CreatePricingRuleOutput, DomainError>> {
    const rule = PricingRule.create(
      UniqueEntityId.from(this.deps.idGenerator.generate()),
      input.type,
      input.value,
      input.priority,
      this.deps.idGenerator.generate(),
      this.deps.clock.now(),
    );
    if (!rule.ok) return err(rule.error);

    return this.deps.unitOfWork.run<Result<CreatePricingRuleOutput, DomainError>>(async (tx) => {
      await this.deps.pricingRules.save(rule.value, input.tenantId, tx);
      return ok({ id: rule.value.id.toString() });
    });
  }
}
