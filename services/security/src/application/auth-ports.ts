import type { AuthMethodKind, MfaMethodKind } from "../domain/value-objects/auth-method";
import type { RiskEngineSignals } from "../domain/risk-engine";

/**
 * The **Cryptography Layer** (sprint P2.0-B §15) — provider-agnostic crypto primitives. The domain
 * never calls a crypto library directly; adapters (node:crypto today, KMS/HSM/cloud providers later)
 * implement this port. Values passed in are handles/material the caller already holds; nothing is
 * persisted here.
 */
export interface CryptoPort {
  hash(value: string): Promise<string>;
  verifyHash(value: string, hash: string): Promise<boolean>;
  encrypt(plaintext: string, keyRef: string): Promise<string>;
  decrypt(ciphertext: string, keyRef: string): Promise<string>;
  sign(payload: string, keyRef: string): Promise<string>;
  verify(payload: string, signature: string, keyRef: string): Promise<boolean>;
  wrapKey(keyMaterial: string, kekRef: string): Promise<string>;
  unwrapKey(wrapped: string, kekRef: string): Promise<string>;
  randomToken(bytes?: number): Promise<string>;
}

export interface AuthenticationRequest {
  readonly method: AuthMethodKind;
  /** The claimed identifier (email/username/subject/assertion id) — provider-specific. */
  readonly identifier: string;
  /** The presented credential/assertion (password/OTP/SAML response/…), when applicable. */
  readonly credential?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AuthenticationResult {
  readonly ok: boolean;
  /** The resolved principal's external id on success. */
  readonly principalExternalId?: string;
  readonly reason?: string;
}

/**
 * An **authentication provider plugin** (sprint P2.0-B §1) — verifies one {@link AuthMethodKind}.
 * Concrete providers (a password verifier, an OIDC/SAML/LDAP bridge, Kratos, Auth0, Cognito, Clerk…)
 * implement this; Security is **never** coupled to any of them.
 */
export interface AuthenticationProviderPort {
  readonly method: AuthMethodKind;
  authenticate(request: AuthenticationRequest): Promise<AuthenticationResult>;
}

/** Resolves the registered authentication provider for a method (composition wires the plugins). */
export interface AuthenticationProviderResolver {
  get(method: AuthMethodKind): AuthenticationProviderPort | null;
  supportedMethods(): readonly AuthMethodKind[];
}

/**
 * An **MFA provider plugin** (sprint P2.0-B §2) — enrolls/challenges/verifies one {@link MfaMethodKind}.
 * `enroll` returns a secret **reference** (seed lives in KMS/authenticator), never the raw secret.
 */
export interface MfaProviderPort {
  readonly method: MfaMethodKind;
  /**
   * `provisioningUri` (an `otpauth://` URI, when the method has one) is returned to the caller
   * exactly once, at enrollment — the same "shown once" convention `GenerateBackupCodes` uses for
   * backup codes. Nothing persists it; a lost enrollment must be revoked and re-enrolled.
   */
  enroll(input: {
    readonly principalRef: string;
  }): Promise<{ readonly secretRef: string; readonly provisioningUri?: string }>;
  issueChallenge(input: {
    readonly secretRef: string | null;
    readonly deliveryHint?: string;
  }): Promise<{ readonly challengeRef: string }>;
  verify(input: { readonly secretRef: string | null; readonly code: string }): Promise<boolean>;
}

export interface MfaProviderResolver {
  get(method: MfaMethodKind): MfaProviderPort | null;
  supportedMethods(): readonly MfaMethodKind[];
}

/** Geo/ASN/anonymizer enrichment feeding the Risk Engine (sprint P2.0-B §4/§10). Interface only. */
export interface GeoIpPort {
  lookup(
    ip: string,
  ): Promise<
    Partial<
      Pick<RiskEngineSignals, "tor" | "vpn" | "ipReputation" | "asnReputation" | "newGeo">
    > & { readonly country?: string; readonly asn?: string }
  >;
}
