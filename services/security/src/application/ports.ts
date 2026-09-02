import type { RiskSignals, TrustSignals } from "../domain/risk";

/**
 * Outbound ports the Security context depends on — **interfaces only**. Providers (KMS/HSM/Vault,
 * Keto/Kratos, threat-intel, device-trust) are wired later without touching the domain (ADR-0023
 * future-ready extension ports; gaps G-SEC-2/G-SEC-4). Security **reuses** these capabilities; it
 * does not reimplement them (no duplicated auth/encryption/secrets — cross-cutting rule 1).
 */

/**
 * Key-management port (Part 7) — abstracts AWS KMS / Azure Key Vault / GCP KMS / HashiCorp Vault
 * behind key **references**. Secret *values* never flow through the domain: {@link generateKeyRef}
 * returns a pointer, {@link rotate} returns the next pointer, {@link fingerprint} derives the
 * non-reversible fingerprint stored on a {@link Credential}.
 */
export interface KmsPort {
  generateKeyRef(purpose: string): Promise<string>;
  rotate(keyRef: string): Promise<string>;
  /** Non-reversible fingerprint of a supplied secret material handle (never the raw value). */
  fingerprint(material: string): Promise<string>;
}

/** Hardware-backed key operations (Part 7) — HSM/confidential-compute. Interface only for now. */
export interface HsmPort {
  sign(keyRef: string, payload: string): Promise<string>;
  verify(keyRef: string, payload: string, signature: string): Promise<boolean>;
}

/**
 * Full **HSM provider** port (G-SEC-2 / H-3) — hardware-backed asymmetric keys whose private material
 * **never leaves the HSM boundary**. Every operation references a key by its non-exportable handle/label;
 * there is intentionally no `export`/`getPrivateKey`. Concrete adapters (PKCS#11 / AWS CloudHSM / YubiHSM)
 * bind this in the composition layer — the Security context is never coupled to a specific HSM vendor,
 * exactly as it is never coupled to a KMS or threat-intel vendor.
 */
export interface HsmProviderPort {
  /** The bound HSM adapter's name (`pkcs11` / `cloudhsm` / `yubihsm`) — for audit/registry/telemetry. */
  readonly name: string;
  /** Generates a key pair inside the HSM and returns its non-exportable handle/label reference. */
  generateKey(input: {
    readonly label: string;
    readonly algorithm: HsmKeyAlgorithm;
  }): Promise<HsmKeyRef>;
  /** Returns the SPKI-encoded **public** key for a handle (public material may leave; private never does). */
  getPublicKey(keyRef: string): Promise<string>;
  /** Signs a payload with the HSM-resident private key. The key material never leaves the device. */
  sign(keyRef: string, payload: string): Promise<string>;
  /** Verifies a signature against an HSM-resident key. */
  verify(keyRef: string, payload: string, signature: string): Promise<boolean>;
}

/** Asymmetric algorithms an {@link HsmProviderPort} may provision. */
export type HsmKeyAlgorithm = "ecdsa-p256" | "ecdsa-p384" | "rsa-2048" | "rsa-4096";

/** A reference to an HSM-resident key — the handle/label plus its (public) algorithm. */
export interface HsmKeyRef {
  readonly keyRef: string;
  readonly algorithm: HsmKeyAlgorithm;
}

/**
 * Read-only reference to the **Identity** context's human users (frozen ownership). Security stores
 * no human PII — it resolves a `subjectRef` to confirm existence/status only.
 */
export interface IdentityDirectoryPort {
  exists(subjectRef: string): Promise<boolean>;
}

/**
 * Read-only reference to the **Identity** context's consent (Part 5). Consent grants/revocations are
 * owned and emitted by Identity — Security references them for compliance decisions, never re-owns.
 * The production adapter answers from a local **projection** kept current by consuming Identity's
 * `identity.customer.consent_changed` events (G-SEC-4 / H-2); it never re-derives or re-stores consent.
 */
export interface ConsentPort {
  hasConsent(subjectRef: string, purpose: string): Promise<boolean>;
}

/** A projected consent fact — Identity remains the owner; this is a read-optimised copy (H-2). */
export interface ConsentProjectionRecord {
  readonly subjectRef: string;
  /** The consent scope/purpose (Identity's `ConsentScope`). */
  readonly purpose: string;
  readonly granted: boolean;
  /** Source event time — the store keeps the latest (last-writer-wins) per (subjectRef, purpose). */
  readonly occurredAt: string;
}

/**
 * Persists the consent projection Security consumes from Identity events (H-2). `upsert` is
 * last-writer-wins by {@link ConsentProjectionRecord.occurredAt}, so out-of-order / redelivered
 * events converge without ever regressing a newer decision. The {@link ConsentPort} reads it.
 */
export interface ConsentProjectionStore {
  upsert(record: ConsentProjectionRecord, tx?: unknown): Promise<void>;
  get(subjectRef: string, purpose: string, tx?: unknown): Promise<ConsentProjectionRecord | null>;
}

/**
 * Read projections of **Identity**-owned facts (H-2). Identity owns Users/Organizations/Memberships and
 * emits them as integration events; Security keeps a read-optimised copy for **resolution** during
 * authorization/session decisions — it never re-owns, re-derives, or writes back. `occurredAt` (RFC 3339)
 * is the last-writer-wins key; Kafka per-aggregate ordering guarantees create-before-mutate causally.
 */
export interface IdentityUserRecord {
  /** The Identity user id (= a human principal's `subjectRef`, the shared identity id). */
  readonly userId: string;
  /** The user's owning tenant (from `identity.user.created`); null when only a status event was seen. */
  readonly userTenant: string | null;
  readonly status: "active" | "deactivated";
  readonly occurredAt: string;
}

export interface IdentityOrganizationRecord {
  readonly organizationId: string;
  readonly slug: string;
  readonly orgTenant: string | null;
  readonly occurredAt: string;
}

export interface IdentityMembershipRecord {
  readonly membershipId: string;
  readonly userId: string;
  readonly organizationId: string;
  /** Role **name** (Identity owns the name; Security/Keto own what it grants — ADR-0007/0023). */
  readonly role: string;
  readonly occurredAt: string;
}

/**
 * Persists Security's read projection of Identity's users/organizations/memberships (H-2). All writes are
 * last-writer-wins by `occurredAt`; status/role mutations update in place (create precedes mutate per
 * Kafka aggregate ordering). Every row is tenant-scoped by the store's injected deployment tenant
 * (ADR-0008); the Identity entity's own tenant is a business column.
 */
export interface IdentityProjectionStore {
  upsertUser(record: IdentityUserRecord, tx?: unknown): Promise<void>;
  setUserStatus(
    userId: string,
    status: IdentityUserRecord["status"],
    occurredAt: string,
    tx?: unknown,
  ): Promise<void>;
  getUser(userId: string, tx?: unknown): Promise<IdentityUserRecord | null>;
  upsertOrganization(record: IdentityOrganizationRecord, tx?: unknown): Promise<void>;
  getOrganization(organizationId: string, tx?: unknown): Promise<IdentityOrganizationRecord | null>;
  upsertMembership(record: IdentityMembershipRecord, tx?: unknown): Promise<void>;
  setMembershipRole(
    membershipId: string,
    role: string,
    occurredAt: string,
    tx?: unknown,
  ): Promise<void>;
  listMembershipsByUser(userId: string, tx?: unknown): Promise<readonly IdentityMembershipRecord[]>;
}

/**
 * Propagates a Security session-revocation decision to the **session enforcement point** (Ory Kratos).
 * Security owns the session *lifecycle*; Kratos owns token issuance/validation — a "logout everywhere"
 * decision (compromise response / force-logout) must actually revoke the identity's Kratos sessions.
 * The production adapter delegates to Kratos's admin API (H-2 / G-SEC-4); interface only here.
 */
export interface SessionRevocationPort {
  /** Revokes every active Kratos session for an identity (its Kratos/Identity external id). */
  revokeAllForIdentity(externalIdentityId: string): Promise<void>;
}

/** Device-trust signal source (Part 6/9) — device fingerprint → trusted flag. Interface only. */
export interface DeviceTrustPort {
  isTrusted(deviceRef: string): Promise<boolean>;
}

/** Threat-intelligence feed (Part 6/9) — reputation lookups feeding {@link RiskSignals}. */
export interface ThreatIntelFeedPort {
  reputation(indicator: string): Promise<number>;
}

/** A resolved bundle of risk/trust signals for an evaluation (assembled from the ports above). */
export interface SignalBundle {
  readonly risk: RiskSignals;
  readonly trust: TrustSignals;
}

/**
 * Security telemetry/metrics sink (Part 9) — counters/gauges for failed auth, denied requests,
 * session/permission/audit activity and threat indicators. In-memory by default; OTel later (G-19).
 */
export interface SecurityTelemetryPort {
  increment(metric: SecurityMetric, tags?: Readonly<Record<string, string>>): void;
  observe(metric: SecurityMetric, value: number, tags?: Readonly<Record<string, string>>): void;
  /** Records a risk-band occurrence for the security-analytics risk distribution (§13). */
  recordRiskBand(band: string): void;
}

export type SecurityMetric =
  | "security.auth.failed"
  | "security.access.denied"
  | "security.access.challenged"
  | "security.access.allowed"
  | "security.session.established"
  | "security.session.revoked"
  | "security.permission.granted"
  | "security.permission.revoked"
  | "security.credential.rotated"
  | "security.audit.recorded"
  | "security.threat.indicated"
  // P2.0-B — login/MFA analytics
  | "security.login.succeeded"
  | "security.login.failed"
  | "security.mfa.succeeded"
  | "security.mfa.failed"
  | "security.token.refreshed"
  // P2.0.3 — external session federation (ADR-0031)
  | "security.session.federated"
  | "security.session.federation_rejected";
