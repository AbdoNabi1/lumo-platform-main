import { defaultDigest } from "../domain/audit-chain";
import type {
  DeviceTrustPort,
  IdentityDirectoryPort,
  KmsPort,
  SecurityMetric,
  SecurityTelemetryPort,
  SessionRevocationPort,
} from "../application/ports";

/**
 * In-memory {@link KmsPort} — deterministic key references + non-reversible fingerprints, offline.
 * Real AWS KMS / Azure Key Vault / GCP KMS / HashiCorp Vault adapters implement the same interface
 * later (gap G-SEC-2). No secret value is ever returned or stored.
 */
export class InMemoryKms implements KmsPort {
  private counter = 0;
  async generateKeyRef(purpose: string): Promise<string> {
    this.counter += 1;
    return `kms://local/${purpose}/${this.counter}#v1`;
  }
  async rotate(keyRef: string): Promise<string> {
    const [base, version] = keyRef.split("#v");
    const next = Number.parseInt(version ?? "1", 10) + 1;
    return `${base ?? keyRef}#v${next}`;
  }
  async fingerprint(material: string): Promise<string> {
    return `fp_${defaultDigest(material)}`;
  }
}

/** In-memory {@link IdentityDirectoryPort} — a seedable set of known Identity subject refs (read-only). */
export class InMemoryIdentityDirectory implements IdentityDirectoryPort {
  private readonly subjects = new Set<string>();
  constructor(seed: readonly string[] = []) {
    for (const s of seed) this.subjects.add(s);
  }
  register(subjectRef: string): void {
    this.subjects.add(subjectRef);
  }
  async exists(subjectRef: string): Promise<boolean> {
    return this.subjects.has(subjectRef);
  }
}

/**
 * In-memory {@link SessionRevocationPort} (offline/tests) — records which identities were revoked so a
 * test can assert the session-sync fired. The Kratos-backed {@link KratosSessionRevoker} implements the
 * same contract in production (H-2). Not a fake: it faithfully records the real revocation contract.
 */
export class RecordingSessionRevocation implements SessionRevocationPort {
  private readonly revoked: string[] = [];
  async revokeAllForIdentity(externalIdentityId: string): Promise<void> {
    this.revoked.push(externalIdentityId);
  }
  /** Identities whose sessions were revoked, in call order. */
  revokedIdentities(): readonly string[] {
    return [...this.revoked];
  }
}

/** In-memory {@link DeviceTrustPort} — a seedable set of trusted device refs. */
export class InMemoryDeviceTrust implements DeviceTrustPort {
  private readonly trusted = new Set<string>();
  constructor(seed: readonly string[] = []) {
    for (const d of seed) this.trusted.add(d);
  }
  trust(deviceRef: string): void {
    this.trusted.add(deviceRef);
  }
  async isTrusted(deviceRef: string): Promise<boolean> {
    return this.trusted.has(deviceRef);
  }
}

/**
 * In-memory {@link SecurityTelemetryPort} — counters + observations for the security dashboard read
 * model and tests. OTel exporters replace this behind the same interface later (G-19).
 */
export class InMemorySecurityTelemetry implements SecurityTelemetryPort {
  private readonly counters = new Map<string, number>();
  private readonly observations = new Map<string, number[]>();
  private readonly riskBands = new Map<string, number>();

  increment(metric: SecurityMetric): void {
    this.counters.set(metric, (this.counters.get(metric) ?? 0) + 1);
  }
  observe(metric: SecurityMetric, value: number): void {
    const list = this.observations.get(metric) ?? [];
    list.push(value);
    this.observations.set(metric, list);
  }
  recordRiskBand(band: string): void {
    this.riskBands.set(band, (this.riskBands.get(band) ?? 0) + 1);
  }
  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.counters);
  }
  riskDistribution(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.riskBands);
  }
}
