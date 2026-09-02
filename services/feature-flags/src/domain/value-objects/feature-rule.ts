import { ValueObject } from "@platform/domain";

export type FeatureRuleType = "tenant" | "user" | "attribute";

interface FeatureRuleProps {
  readonly type: FeatureRuleType;
  readonly attribute?: string;
  readonly values: readonly string[];
  readonly enabled: boolean;
}

/** A targeting rule — matches on tenant/user id or an arbitrary evaluation-context attribute. */
export class FeatureRule extends ValueObject<FeatureRuleProps> {
  static create(
    type: FeatureRuleType,
    values: readonly string[],
    enabled: boolean,
    attribute?: string,
  ): FeatureRule {
    return new FeatureRule({ type, attribute, values, enabled });
  }

  /** Whether this rule matches the given subject/attributes — pure, no side effects. */
  matches(subjectId: string, attributes: Readonly<Record<string, string>> = {}): boolean {
    if (this.props.type === "attribute") {
      const value =
        this.props.attribute === undefined ? undefined : attributes[this.props.attribute];
      return value !== undefined && this.props.values.includes(value);
    }
    return this.props.values.includes(subjectId);
  }

  get type(): FeatureRuleType {
    return this.props.type;
  }

  get attribute(): string | undefined {
    return this.props.attribute;
  }

  get values(): readonly string[] {
    return this.props.values;
  }

  get enabled(): boolean {
    return this.props.enabled;
  }
}

/** The result of evaluating a flag against a context — not persisted, a pure return shape. */
export interface FeatureEvaluation {
  readonly enabled: boolean;
  readonly reason: "killed" | "archived" | "rule_match" | "environment_override" | "rollout_bucket";
}
