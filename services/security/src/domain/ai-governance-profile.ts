import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";
import { ResourceUrn } from "./value-objects/resource-urn";

export const AI_ISOLATION_LEVELS = ["none", "sandboxed", "isolated"] as const;
export type AiIsolationLevel = (typeof AI_ISOLATION_LEVELS)[number];

export const AI_GOVERNANCE_STATUSES = ["active", "suspended"] as const;
export type AiGovernanceStatus = (typeof AI_GOVERNANCE_STATUSES)[number];

export interface AiGovernanceConfig {
  /** Max tokens per rolling window (null ⇒ unlimited). */
  readonly tokenBudget?: number | null;
  /** Max calls per rolling window (null ⇒ unlimited). */
  readonly callQuota?: number | null;
  readonly windowSeconds?: number;
  /** Sandboxing: tools the AI identity may invoke (empty ⇒ unrestricted). */
  readonly allowedTools?: readonly string[];
  /** Isolation: resource URN patterns the AI identity may touch (empty ⇒ unrestricted). */
  readonly allowedResources?: readonly string[];
  readonly isolationLevel?: AiIsolationLevel;
}

export interface ConsumptionDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly remainingTokens: number | null;
  readonly remainingCalls: number | null;
}

interface AiGovernanceProfileProps {
  readonly principalRef: string;
  tokenBudget: number | null;
  callQuota: number | null;
  windowSeconds: number;
  tokensConsumed: number;
  callsConsumed: number;
  windowResetAt: Date;
  allowedTools: string[];
  allowedResources: string[];
  isolationLevel: AiIsolationLevel;
  status: AiGovernanceStatus;
}

/**
 * An **AI governance profile** (sprint P2.0-F §20) — governs an `ai`-kind principal on its own terms:
 * **budgets** (tokens/window), **quotas** (calls/window) with a rolling window, **sandboxing** (allowed
 * tools), **isolation** (allowed resource URNs + isolation level). This governance lives in **Security**,
 * not the AI platform. Consumption is checked deterministically; over-budget denials are recorded facts
 * (they emit `budget_exceeded`), never silent. AI audit reuses the WORM ledger.
 */
export class AiGovernanceProfile extends AggregateRoot<AiGovernanceProfileProps> {
  static govern(
    id: UniqueEntityId,
    principalRef: string,
    config: AiGovernanceConfig,
    eventId: string,
    occurredAt: Date,
  ): AiGovernanceProfile {
    if (principalRef.trim().length === 0)
      throw new BusinessRuleError("An AI governance profile needs a principalRef");
    const windowSeconds = config.windowSeconds ?? 86_400;
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0)
      throw new BusinessRuleError("windowSeconds must be a positive integer");
    const profile = new AiGovernanceProfile(
      {
        principalRef: principalRef.trim(),
        tokenBudget: config.tokenBudget ?? null,
        callQuota: config.callQuota ?? null,
        windowSeconds,
        tokensConsumed: 0,
        callsConsumed: 0,
        windowResetAt: new Date(occurredAt.getTime() + windowSeconds * 1000),
        allowedTools: [...(config.allowedTools ?? [])],
        allowedResources: [...(config.allowedResources ?? [])],
        isolationLevel: config.isolationLevel ?? "sandboxed",
        status: "active",
      },
      id,
    );
    profile.emit("security.ai_identity.governed", eventId, occurredAt);
    return profile;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: AiGovernanceProfileProps & { readonly version: number },
  ): AiGovernanceProfile {
    return new AiGovernanceProfile(
      {
        ...base,
        allowedTools: [...base.allowedTools],
        allowedResources: [...base.allowedResources],
      },
      id,
      base.version,
    );
  }

  reconfigure(config: AiGovernanceConfig, eventId: string, occurredAt: Date): void {
    if (config.tokenBudget !== undefined) this.props.tokenBudget = config.tokenBudget;
    if (config.callQuota !== undefined) this.props.callQuota = config.callQuota;
    if (config.windowSeconds !== undefined) this.props.windowSeconds = config.windowSeconds;
    if (config.allowedTools !== undefined) this.props.allowedTools = [...config.allowedTools];
    if (config.allowedResources !== undefined)
      this.props.allowedResources = [...config.allowedResources];
    if (config.isolationLevel !== undefined) this.props.isolationLevel = config.isolationLevel;
    this.emit("security.ai_identity.governed", eventId, occurredAt);
  }

  suspend(eventId: string, occurredAt: Date): void {
    if (this.props.status === "suspended") return;
    this.props.status = "suspended";
    this.emit("security.ai_identity.suspended", eventId, occurredAt);
  }

  /** True when the AI identity may invoke `tool` (sandboxing). */
  permitsTool(tool: string): boolean {
    return this.props.allowedTools.length === 0 || this.props.allowedTools.includes(tool);
  }

  /** True when the AI identity may touch `resource` (isolation) — matches any allowed URN pattern. */
  permitsResource(resource: string): boolean {
    if (this.props.allowedResources.length === 0) return true;
    const target = ResourceUrn.parse(resource);
    if (!target.ok) return false;
    return this.props.allowedResources.some((pattern) => {
      const p = ResourceUrn.parse(pattern);
      return p.ok && target.value.matches(p.value);
    });
  }

  /**
   * Checks + records consumption against the rolling budget/quota. Rolls the window when elapsed.
   * A denial emits `security.ai_identity.budget_exceeded` (a recorded fact) and does not increment.
   */
  consume(tokens: number, calls: number, occurredAt: Date, eventId: string): ConsumptionDecision {
    if (this.props.status === "suspended")
      return {
        allowed: false,
        reason: "AI identity suspended",
        remainingTokens: this.remainingTokens(),
        remainingCalls: this.remainingCalls(),
      };
    if (occurredAt.getTime() >= this.props.windowResetAt.getTime()) {
      this.props.tokensConsumed = 0;
      this.props.callsConsumed = 0;
      this.props.windowResetAt = new Date(occurredAt.getTime() + this.props.windowSeconds * 1000);
    }
    if (
      this.props.tokenBudget !== null &&
      this.props.tokensConsumed + tokens > this.props.tokenBudget
    ) {
      this.emit("security.ai_identity.budget_exceeded", eventId, occurredAt);
      return {
        allowed: false,
        reason: "token budget exceeded",
        remainingTokens: this.remainingTokens(),
        remainingCalls: this.remainingCalls(),
      };
    }
    if (this.props.callQuota !== null && this.props.callsConsumed + calls > this.props.callQuota) {
      this.emit("security.ai_identity.budget_exceeded", eventId, occurredAt);
      return {
        allowed: false,
        reason: "call quota exceeded",
        remainingTokens: this.remainingTokens(),
        remainingCalls: this.remainingCalls(),
      };
    }
    this.props.tokensConsumed += tokens;
    this.props.callsConsumed += calls;
    return {
      allowed: true,
      remainingTokens: this.remainingTokens(),
      remainingCalls: this.remainingCalls(),
    };
  }

  private remainingTokens(): number | null {
    return this.props.tokenBudget === null
      ? null
      : Math.max(0, this.props.tokenBudget - this.props.tokensConsumed);
  }
  private remainingCalls(): number | null {
    return this.props.callQuota === null
      ? null
      : Math.max(0, this.props.callQuota - this.props.callsConsumed);
  }

  get principalRef(): string {
    return this.props.principalRef;
  }
  get tokenBudget(): number | null {
    return this.props.tokenBudget;
  }
  get callQuota(): number | null {
    return this.props.callQuota;
  }
  get tokensConsumed(): number {
    return this.props.tokensConsumed;
  }
  get callsConsumed(): number {
    return this.props.callsConsumed;
  }
  get windowSeconds(): number {
    return this.props.windowSeconds;
  }
  get windowResetAt(): Date {
    return this.props.windowResetAt;
  }
  get allowedTools(): readonly string[] {
    return this.props.allowedTools;
  }
  get allowedResources(): readonly string[] {
    return this.props.allowedResources;
  }
  get isolationLevel(): AiIsolationLevel {
    return this.props.isolationLevel;
  }
  get status(): AiGovernanceStatus {
    return this.props.status;
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "ai_identity",
          key: this.props.principalRef,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
