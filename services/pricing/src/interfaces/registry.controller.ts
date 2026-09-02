import type {
  CreatePricingRule,
  CreatePricingRuleInput,
} from "../application/create-pricing-rule.use-case";
import type { CreateTaxClass, CreateTaxClassInput } from "../application/create-tax-class.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface RegistryControllerDeps {
  readonly createTaxClass: CreateTaxClass;
  readonly createPricingRule: CreatePricingRule;
}

/** Framework-agnostic interface boundary for the Pricing registry (TaxClass/PricingRule) use-cases (no HTTP server). */
export class RegistryController {
  private readonly deps: RegistryControllerDeps;

  constructor(deps: RegistryControllerDeps) {
    this.deps = deps;
  }

  async createTaxClass(input: CreateTaxClassInput): Promise<ControllerResponse> {
    return present(await this.deps.createTaxClass.execute(input), 201);
  }

  async createPricingRule(input: CreatePricingRuleInput): Promise<ControllerResponse> {
    return present(await this.deps.createPricingRule.execute(input), 201);
  }
}
