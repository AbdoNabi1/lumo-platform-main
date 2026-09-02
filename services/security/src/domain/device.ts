import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";

export const DEVICE_TRUST_LEVELS = ["untrusted", "recognized", "trusted", "blocked"] as const;
export type DeviceTrustLevel = (typeof DEVICE_TRUST_LEVELS)[number];

export type SignalSeverity = "low" | "medium" | "high";
export interface DeviceSignal {
  readonly type: string;
  readonly severity: SignalSeverity;
  readonly at: Date;
}

const REPUTATION_PENALTY: Readonly<Record<SignalSeverity, number>> = {
  low: 5,
  medium: 15,
  high: 30,
};

interface DeviceProps {
  readonly fingerprint: string;
  principalRef: string | null;
  readonly tenantRef: string | null;
  trustLevel: DeviceTrustLevel;
  reputation: number;
  metadata: Record<string, string>;
  signals: DeviceSignal[];
  anomalyCount: number;
  readonly firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * A **device** — a first-class identity (sprint P2.0-B §3). Keyed by a non-reversible `fingerprint`,
 * it tracks trust level, reputation, security signals/anomalies, metadata and last-seen. Trust is
 * never implicit: a new device starts `untrusted`; explicit `trust()` (e.g. remember-device after
 * MFA) raises it, and signals lower reputation deterministically. Feeds the Risk Engine + zero-trust.
 */
export class Device extends AggregateRoot<DeviceProps> {
  static register(
    id: UniqueEntityId,
    input: {
      readonly fingerprint: string;
      readonly principalRef?: string | null;
      readonly tenantRef?: string | null;
      readonly metadata?: Readonly<Record<string, string>>;
    },
    eventId: string,
    occurredAt: Date,
  ): Device {
    if (input.fingerprint.trim().length === 0)
      throw new BusinessRuleError("A device needs a fingerprint");
    const device = new Device(
      {
        fingerprint: input.fingerprint.trim(),
        principalRef: input.principalRef ?? null,
        tenantRef: input.tenantRef ?? null,
        trustLevel: "untrusted",
        reputation: 50,
        metadata: { ...(input.metadata ?? {}) },
        signals: [],
        anomalyCount: 0,
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
      },
      id,
    );
    device.emit("security.device.registered", eventId, occurredAt);
    return device;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: DeviceProps & { readonly version: number },
  ): Device {
    return new Device(
      { ...base, metadata: { ...base.metadata }, signals: [...base.signals] },
      id,
      base.version,
    );
  }

  /** Records a security signal, lowers reputation deterministically, and counts anomalies. No event (high-volume). */
  recordSignal(signal: DeviceSignal): void {
    this.props.signals = [...this.props.signals, signal].slice(-50);
    this.props.reputation = clamp(this.props.reputation - REPUTATION_PENALTY[signal.severity]);
    if (signal.severity === "high") this.props.anomalyCount += 1;
    this.props.lastSeenAt = signal.at;
  }

  touch(seenAt: Date): void {
    this.props.lastSeenAt = seenAt;
  }

  /** Explicitly trusts the device (remember-device, post-MFA). A blocked device cannot be trusted directly. */
  trust(eventId: string, occurredAt: Date): void {
    if (this.props.trustLevel === "blocked")
      throw new BusinessRuleError("A blocked device must be unblocked before it can be trusted");
    this.props.trustLevel = "trusted";
    this.props.reputation = clamp(Math.max(this.props.reputation, 80));
    this.emit("security.device.trusted", eventId, occurredAt);
  }

  block(eventId: string, occurredAt: Date): void {
    if (this.props.trustLevel === "blocked") return;
    this.props.trustLevel = "blocked";
    this.props.reputation = 0;
    this.emit("security.device.blocked", eventId, occurredAt);
  }

  get fingerprint(): string {
    return this.props.fingerprint;
  }
  get principalRef(): string | null {
    return this.props.principalRef;
  }
  get tenantRef(): string | null {
    return this.props.tenantRef;
  }
  get trustLevel(): DeviceTrustLevel {
    return this.props.trustLevel;
  }
  get reputation(): number {
    return this.props.reputation;
  }
  get anomalyCount(): number {
    return this.props.anomalyCount;
  }
  get signals(): readonly DeviceSignal[] {
    return this.props.signals;
  }
  get metadata(): Readonly<Record<string, string>> {
    return this.props.metadata;
  }
  get firstSeenAt(): Date {
    return this.props.firstSeenAt;
  }
  get lastSeenAt(): Date {
    return this.props.lastSeenAt;
  }
  get isTrusted(): boolean {
    return this.props.trustLevel === "trusted";
  }
  get isBlocked(): boolean {
    return this.props.trustLevel === "blocked";
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "device",
          key: this.props.fingerprint,
          event,
          status: this.props.trustLevel,
        },
      ),
    );
  }
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
