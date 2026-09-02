import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";

export const MACHINE_IDENTITY_STATUSES = ["active", "suspended"] as const;
export type MachineIdentityStatus = (typeof MACHINE_IDENTITY_STATUSES)[number];

export interface MachineIdentityConfig {
  readonly owner?: string;
  readonly purpose?: string;
  readonly allowedEnvironments?: readonly string[];
  readonly maxCredentialTtlSeconds?: number | null;
  readonly rotationIntervalDays?: number | null;
  /** Permission patterns this machine identity may ever be granted (a governance ceiling). */
  readonly allowedScopes?: readonly string[];
}

interface MachineIdentityProfileProps {
  readonly principalRef: string;
  owner: string;
  purpose: string;
  allowedEnvironments: string[];
  maxCredentialTtlSeconds: number | null;
  rotationIntervalDays: number | null;
  allowedScopes: string[];
  status: MachineIdentityStatus;
}

/**
 * A **machine identity governance profile** (sprint P2.0-C §14) — governs one non-human principal
 * (service account / machine / api_key / robot / partner / marketplace / ai) independently: its
 * accountable owner, purpose, allowed environments, maximum credential TTL, rotation interval and the
 * permission-scope ceiling it may be granted. Each non-human identity is thus governed on its own
 * terms (the AI-specific budgets/quotas of §20 layer on top later, no redesign).
 */
export class MachineIdentityProfile extends AggregateRoot<MachineIdentityProfileProps> {
  static govern(
    id: UniqueEntityId,
    principalRef: string,
    config: MachineIdentityConfig,
    eventId: string,
    occurredAt: Date,
  ): MachineIdentityProfile {
    if (principalRef.trim().length === 0)
      throw new BusinessRuleError("A machine identity profile needs a principalRef");
    const profile = new MachineIdentityProfile(
      {
        principalRef: principalRef.trim(),
        owner: (config.owner ?? "").trim(),
        purpose: (config.purpose ?? "").trim(),
        allowedEnvironments: [...(config.allowedEnvironments ?? [])],
        maxCredentialTtlSeconds: config.maxCredentialTtlSeconds ?? null,
        rotationIntervalDays: config.rotationIntervalDays ?? null,
        allowedScopes: [...(config.allowedScopes ?? [])],
        status: "active",
      },
      id,
    );
    profile.emit("security.machine_identity.governed", eventId, occurredAt);
    return profile;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: MachineIdentityProfileProps & { readonly version: number },
  ): MachineIdentityProfile {
    return new MachineIdentityProfile(
      {
        ...base,
        allowedEnvironments: [...base.allowedEnvironments],
        allowedScopes: [...base.allowedScopes],
      },
      id,
      base.version,
    );
  }

  reconfigure(config: MachineIdentityConfig, eventId: string, occurredAt: Date): void {
    if (config.owner !== undefined) this.props.owner = config.owner.trim();
    if (config.purpose !== undefined) this.props.purpose = config.purpose.trim();
    if (config.allowedEnvironments !== undefined)
      this.props.allowedEnvironments = [...config.allowedEnvironments];
    if (config.maxCredentialTtlSeconds !== undefined)
      this.props.maxCredentialTtlSeconds = config.maxCredentialTtlSeconds;
    if (config.rotationIntervalDays !== undefined)
      this.props.rotationIntervalDays = config.rotationIntervalDays;
    if (config.allowedScopes !== undefined) this.props.allowedScopes = [...config.allowedScopes];
    this.emit("security.machine_identity.governed", eventId, occurredAt);
  }

  suspend(eventId: string, occurredAt: Date): void {
    if (this.props.status === "suspended") return;
    this.props.status = "suspended";
    this.emit("security.machine_identity.suspended", eventId, occurredAt);
  }

  reactivate(eventId: string, occurredAt: Date): void {
    if (this.props.status === "active") return;
    this.props.status = "active";
    this.emit("security.machine_identity.governed", eventId, occurredAt);
  }

  /** True when `scope` is within this identity's governance ceiling (empty ceiling ⇒ unrestricted). */
  permits(scope: string): boolean {
    return this.props.allowedScopes.length === 0 || this.props.allowedScopes.includes(scope);
  }

  get principalRef(): string {
    return this.props.principalRef;
  }
  get owner(): string {
    return this.props.owner;
  }
  get purpose(): string {
    return this.props.purpose;
  }
  get allowedEnvironments(): readonly string[] {
    return this.props.allowedEnvironments;
  }
  get maxCredentialTtlSeconds(): number | null {
    return this.props.maxCredentialTtlSeconds;
  }
  get rotationIntervalDays(): number | null {
    return this.props.rotationIntervalDays;
  }
  get allowedScopes(): readonly string[] {
    return this.props.allowedScopes;
  }
  get status(): MachineIdentityStatus {
    return this.props.status;
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "machine_identity",
          key: this.props.principalRef,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
