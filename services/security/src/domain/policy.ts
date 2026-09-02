import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";

/** The four zero-trust outcomes (ADR-0023 §3). `block` denies; `challenge` steps up; `review` flags. */
export const POLICY_EFFECTS = ["allow", "challenge", "block", "review"] as const;
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];

/** Policy posture presets (ADR-0023 §2). `custom` requires an explicit default effect. */
export const POLICY_MODES = ["strict", "balanced", "relaxed", "custom"] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

export const POLICY_STATUSES = ["draft", "active", "archived"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export type { PolicyCondition } from "./policy-condition";
import type { PolicyCondition } from "./policy-condition";
import type { PolicyExpression } from "./policy-expression";

export interface PolicyRule {
  readonly id: string;
  readonly description: string;
  /** Leaf condition (back-compat). Ignored when {@link PolicyRule.expr} is present. */
  readonly when: PolicyCondition;
  /** Optional composable boolean expression (AND/OR/NOT/fragments) — sprint P2.0-D §8. */
  readonly expr?: PolicyExpression;
  readonly effect: PolicyEffect;
}

/** An **immutable** published policy version — never mutated after publish (like Licensing plans). */
export class PolicyVersion {
  readonly version: number;
  readonly rules: readonly PolicyRule[];
  readonly defaultEffect: PolicyEffect;
  readonly publishedAt: Date;

  constructor(props: {
    version: number;
    rules: readonly PolicyRule[];
    defaultEffect: PolicyEffect;
    publishedAt: Date;
  }) {
    this.version = props.version;
    this.rules = Object.freeze([...props.rules]);
    this.defaultEffect = props.defaultEffect;
    this.publishedAt = props.publishedAt;
    Object.freeze(this);
  }
}

/**
 * Default effect when **no rule matches** (deny-by-default only for `strict`). `balanced` and
 * `relaxed` both allow by default and differ by the rule-sets authored on top (balanced ships
 * stricter rules); `custom` must state its own default at publish time.
 */
const DEFAULT_EFFECT_BY_MODE: Readonly<Record<Exclude<PolicyMode, "custom">, PolicyEffect>> = {
  strict: "block",
  balanced: "allow",
  relaxed: "allow",
};

interface PolicyProps {
  readonly key: string;
  name: string;
  mode: PolicyMode;
  status: PolicyStatus;
  versions: PolicyVersion[];
  activeVersion: number | null;
}

/**
 * A **security policy** — a named, versioned set of zero-trust rules with **immutable** versions.
 * Publishing appends a new version and activates it (the prior versions stay for audit/simulation).
 * The {@link ZeroTrustEvaluator} reads the active version; policy is data, so it can be simulated,
 * explained and traced without redeploy (ADR-0023, sprint Part 3).
 */
export class Policy extends AggregateRoot<PolicyProps> {
  static define(
    id: UniqueEntityId,
    input: { readonly key: string; readonly name: string; readonly mode: PolicyMode },
    eventId: string,
    occurredAt: Date,
  ): Policy {
    if (input.key.trim().length === 0) throw new BusinessRuleError("A policy needs a key");
    if (input.name.trim().length === 0) throw new BusinessRuleError("A policy needs a name");
    const policy = new Policy(
      {
        key: input.key.trim(),
        name: input.name.trim(),
        mode: input.mode,
        status: "draft",
        versions: [],
        activeVersion: null,
      },
      id,
    );
    policy.emit("security.policy.defined", eventId, occurredAt);
    return policy;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: {
      readonly key: string;
      readonly name: string;
      readonly mode: PolicyMode;
      readonly status: PolicyStatus;
      readonly versions: readonly PolicyVersion[];
      readonly activeVersion: number | null;
      readonly version: number;
    },
  ): Policy {
    return new Policy(
      {
        key: base.key,
        name: base.name,
        mode: base.mode,
        status: base.status,
        versions: [...base.versions],
        activeVersion: base.activeVersion,
      },
      id,
      base.version,
    );
  }

  publishVersion(
    input: { readonly rules: readonly PolicyRule[]; readonly defaultEffect?: PolicyEffect },
    eventId: string,
    occurredAt: Date,
  ): PolicyVersion {
    if (this.props.status === "archived")
      throw new BusinessRuleError("An archived policy cannot publish a version");
    const mode = this.props.mode;
    const defaultEffect =
      input.defaultEffect ?? (mode === "custom" ? undefined : DEFAULT_EFFECT_BY_MODE[mode]);
    if (defaultEffect === undefined)
      throw new BusinessRuleError("A custom-mode policy requires an explicit defaultEffect");
    for (const rule of input.rules) {
      if (rule.id.trim().length === 0) throw new BusinessRuleError("Every policy rule needs an id");
    }
    const nextVersion = this.props.versions.length + 1;
    const published = new PolicyVersion({
      version: nextVersion,
      rules: input.rules,
      defaultEffect,
      publishedAt: occurredAt,
    });
    this.props.versions = [...this.props.versions, published];
    this.props.activeVersion = nextVersion;
    this.props.status = "active";
    this.emit("security.policy.version_published", eventId, occurredAt);
    return published;
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status === "archived") return;
    this.props.status = "archived";
    this.emit("security.policy.archived", eventId, occurredAt);
  }

  get key(): string {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get mode(): PolicyMode {
    return this.props.mode;
  }
  get status(): PolicyStatus {
    return this.props.status;
  }
  get versions(): readonly PolicyVersion[] {
    return this.props.versions;
  }
  get activeVersionNumber(): number | null {
    return this.props.activeVersion;
  }

  /** The active immutable version the evaluator uses, or null when the policy has never published. */
  activePolicyVersion(): PolicyVersion | null {
    if (this.props.activeVersion === null) return null;
    return this.props.versions.find((v) => v.version === this.props.activeVersion) ?? null;
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "policy",
          key: this.props.key,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
