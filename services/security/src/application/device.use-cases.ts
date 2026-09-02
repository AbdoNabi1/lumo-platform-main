import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import { Device, type SignalSeverity } from "../domain/device";
import { recordAudit, type SecurityDeps } from "./deps";

export interface DeviceOutput {
  readonly id: string;
  readonly fingerprint: string;
  readonly principalRef: string | null;
  readonly trustLevel: string;
  readonly reputation: number;
  readonly anomalyCount: number;
  readonly lastSeenAt: string;
}

function present(d: Device): DeviceOutput {
  return {
    id: d.id.toString(),
    fingerprint: d.fingerprint,
    principalRef: d.principalRef,
    trustLevel: d.trustLevel,
    reputation: d.reputation,
    anomalyCount: d.anomalyCount,
    lastSeenAt: d.lastSeenAt.toISOString(),
  };
}

export interface RegisterDeviceInput {
  readonly fingerprint: string;
  readonly principalExternalId?: string;
  readonly tenantRef?: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Registers a device (idempotent per fingerprint; starts `untrusted`). Emits `security.device.registered`. */
export class RegisterDevice implements UseCase<RegisterDeviceInput, DeviceOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RegisterDeviceInput): Promise<Result<DeviceOutput, DomainError>> {
    let principalRef: string | null = null;
    if (input.principalExternalId !== undefined) {
      const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
      if (principal === null) return err(new NotFoundError("Principal not found"));
      principalRef = principal.id.toString();
    }
    return this.deps.unitOfWork.run<Result<DeviceOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.devices.findByFingerprint(input.fingerprint, tx);
      if (existing !== null) return ok(present(existing));
      let device: Device;
      try {
        device = Device.register(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            fingerprint: input.fingerprint,
            principalRef,
            tenantRef: input.tenantRef ?? null,
            metadata: input.metadata,
          },
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.devices.save(device, tx);
      await recordAudit(this.deps, tx, {
        principalRef: principalRef ?? "anonymous",
        action: "security.device.registered",
        decision: "allow",
        tenantRef: input.tenantRef ?? null,
        metadata: { fingerprint: input.fingerprint },
      });
      return ok(present(device));
    });
  }
}

export interface RecordDeviceSignalInput {
  readonly fingerprint: string;
  readonly type: string;
  readonly severity: SignalSeverity;
}

/** Records a device security signal (lowers reputation, counts anomalies). Telemetry only for high severity. */
export class RecordDeviceSignal implements UseCase<
  RecordDeviceSignalInput,
  DeviceOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RecordDeviceSignalInput): Promise<Result<DeviceOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeviceOutput, DomainError>>(async (tx) => {
      const device = await this.deps.devices.findByFingerprint(input.fingerprint, tx);
      if (device === null) return err(new NotFoundError("Device not found"));
      device.recordSignal({
        type: input.type,
        severity: input.severity,
        at: this.deps.clock.now(),
      });
      await this.deps.devices.save(device, tx);
      if (input.severity === "high") this.deps.telemetry.increment("security.threat.indicated");
      return ok(present(device));
    });
  }
}

export interface DeviceActionInput {
  readonly fingerprint: string;
}

/** Explicitly trusts a device (remember-device). Emits `security.device.trusted` + audit. */
export class TrustDevice implements UseCase<DeviceActionInput, DeviceOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: DeviceActionInput): Promise<Result<DeviceOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeviceOutput, DomainError>>(async (tx) => {
      const device = await this.deps.devices.findByFingerprint(input.fingerprint, tx);
      if (device === null) return err(new NotFoundError("Device not found"));
      try {
        device.trust(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.devices.save(device, tx);
      await recordAudit(this.deps, tx, {
        principalRef: device.principalRef ?? "anonymous",
        action: "security.device.trusted",
        decision: "allow",
        metadata: { fingerprint: device.fingerprint },
      });
      return ok(present(device));
    });
  }
}

/** Blocks a device. Emits `security.device.blocked` + audit. */
export class BlockDevice implements UseCase<DeviceActionInput, DeviceOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: DeviceActionInput): Promise<Result<DeviceOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeviceOutput, DomainError>>(async (tx) => {
      const device = await this.deps.devices.findByFingerprint(input.fingerprint, tx);
      if (device === null) return err(new NotFoundError("Device not found"));
      device.block(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.devices.save(device, tx);
      await recordAudit(this.deps, tx, {
        principalRef: device.principalRef ?? "anonymous",
        action: "security.device.blocked",
        decision: "block",
        metadata: { fingerprint: device.fingerprint },
      });
      return ok(present(device));
    });
  }
}
