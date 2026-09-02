import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

export type MerchantOverrideState = "enabled" | "disabled" | "temp_grant" | "temp_block";

interface MerchantFeatureOverrideProps {
  readonly tenantRef: string;
  readonly featureKey: string;
  state: MerchantOverrideState;
  expiresAt?: Date;
  notes?: string;
}

/**
 * Sprint-5.5 manual override layer — kept for backward compatibility (Sprint-5.6 addendum §F:
 * "the Sprint-5.5 `MerchantFeatureOverride` remains for backward compatibility;
 * `MerchantCapabilities` is the go-forward operational layer"). Lets Support/Operations
 * enable/disable a merchant's business capability without changing plans; every mutation is
 * WORM-audited (ADR-0009) via its own domain events.
 */
export class MerchantFeatureOverride extends AggregateRoot<MerchantFeatureOverrideProps> {
  static create(
    id: UniqueEntityId,
    tenantRef: string,
    featureKey: string,
    state: MerchantOverrideState,
    eventId: string,
    occurredAt: Date,
    expiresAt?: Date,
    notes?: string,
  ): MerchantFeatureOverride {
    const override = new MerchantFeatureOverride(
      { tenantRef, featureKey, state, expiresAt, notes },
      id,
    );
    override.raise("created", eventId, occurredAt);
    return override;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    featureKey: string,
    state: MerchantOverrideState,
    version: number,
    expiresAt?: Date,
    notes?: string,
  ): MerchantFeatureOverride {
    return new MerchantFeatureOverride(
      { tenantRef, featureKey, state, expiresAt, notes },
      id,
      version,
    );
  }

  setState(
    state: MerchantOverrideState,
    eventId: string,
    occurredAt: Date,
    expiresAt?: Date,
    notes?: string,
  ): void {
    this.props.state = state;
    this.props.expiresAt = expiresAt;
    this.props.notes = notes;
    this.raise("state_changed", eventId, occurredAt);
  }

  /** Resolves the effective state, honoring `expiresAt` (an expired temp grant/block is inert). */
  effectiveState(now: Date): MerchantOverrideState | undefined {
    if (this.props.expiresAt !== undefined && this.props.expiresAt.getTime() <= now.getTime()) {
      return undefined;
    }
    return this.props.state;
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: `${this.props.tenantRef}:${this.props.featureKey}`,
          family: "merchant_feature_override",
          action,
        },
      ),
    );
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }

  get featureKey(): string {
    return this.props.featureKey;
  }

  get state(): MerchantOverrideState {
    return this.props.state;
  }

  get expiresAt(): Date | undefined {
    return this.props.expiresAt;
  }

  get notes(): string | undefined {
    return this.props.notes;
  }
}
