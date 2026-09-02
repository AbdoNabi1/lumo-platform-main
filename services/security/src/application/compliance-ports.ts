import type { ComplianceFramework } from "../domain/value-objects/compliance";
import type { ComplianceRulePack } from "../domain/compliance-engine";

/** Resolves the pluggable {@link ComplianceRulePack} for a framework (composition wires the packs). */
export interface ComplianceRulePackResolver {
  get(framework: ComplianceFramework): ComplianceRulePack | null;
  frameworks(): readonly ComplianceFramework[];
}
