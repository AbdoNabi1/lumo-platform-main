import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import {
  SignJWT,
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  jwtVerify,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";

/**
 * Plan 1B-2: loads the runtime's own signing key. Accepts a PKCS#8 PEM, or the same PEM base64-encoded
 * (one line — what a hosting dashboard's env field can hold). EC P-256 only (ES256).
 */
export function loadSigningKey(raw: string): KeyObject {
  const trimmed = raw.trim();
  const pem = trimmed.startsWith("-----BEGIN")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8").trim();
  if (!pem.startsWith("-----BEGIN")) throw new Error("AUTH_SIGNING_KEY is not a PEM private key");
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("AUTH_SIGNING_KEY must be an EC P-256 private key (ES256)");
  }
  return key;
}

export interface NativeTokenIssuerOptions {
  readonly privateKey: KeyObject;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
  readonly now?: () => Date;
}

export interface NativeStaffClaims {
  readonly sub: string;
  readonly tenantId: string;
  readonly kind: "staff";
  readonly roles: readonly string[];
  readonly sid: string;
  readonly email?: string;
}

/** Wave 1e: what a sign-in challenge says — a correct password for this staff member, nothing more. */
export interface MfaChallengeClaims {
  readonly sub: string;
  readonly tenantId: string;
  readonly email: string;
}

/**
 * Wave 1f: a sign-in challenge has a purpose. `staff-login-mfa` = "a code is owed" (the verify step);
 * `staff-login-mfa-setup` = "set two-step up now" (the setup-at-sign-in step). Each has its own `typ`,
 * audience and `purpose` claim, so one can never be accepted as the other — nor as a session token.
 */
export type MfaChallengePurpose = "staff-login-mfa" | "staff-login-mfa-setup";

const CHALLENGE_SPECS: Readonly<
  Record<
    MfaChallengePurpose,
    { readonly typ: string; readonly audienceSuffix: string; readonly defaultTtlSeconds: number }
  >
> = {
  "staff-login-mfa": {
    typ: "mfa-challenge+jwt",
    audienceSuffix: "mfa-challenge",
    defaultTtlSeconds: 300,
  },
  "staff-login-mfa-setup": {
    typ: "mfa-setup+jwt",
    audienceSuffix: "mfa-setup",
    defaultTtlSeconds: 600,
  },
};
const DEFAULT_CHALLENGE_PURPOSE: MfaChallengePurpose = "staff-login-mfa";
const CHALLENGE_CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Plan 1B-2: the platform's own token issuer (replaces Ory Hydra for staff sign-in). Claims match
 * what `JwtVerifier` and the HTTP pipeline already read: `sub`, `kind`, `roles`, `tenant_id`.
 */
export class NativeTokenIssuer {
  private readonly options: NativeTokenIssuerOptions;
  private readonly publicJwk: Promise<JWK>;

  constructor(options: NativeTokenIssuerOptions) {
    this.options = options;
    this.publicJwk = (async () => {
      const jwk = await exportJWK(createPublicKey(options.privateKey));
      const kid = await calculateJwkThumbprint(jwk);
      return { ...jwk, kid, alg: "ES256", use: "sig" };
    })();
  }

  async issue(claims: NativeStaffClaims): Promise<{ token: string; expiresIn: number }> {
    const { kid } = await this.publicJwk;
    const nowSeconds = Math.floor((this.options.now?.() ?? new Date()).getTime() / 1000);
    const token = await new SignJWT({
      kind: claims.kind,
      roles: [...claims.roles],
      tenant_id: claims.tenantId,
      sid: claims.sid,
      ...(claims.email === undefined ? {} : { email: claims.email }),
    })
      .setProtectedHeader({ alg: "ES256", ...(kid === undefined ? {} : { kid }) })
      .setSubject(claims.sub)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + this.options.ttlSeconds)
      .sign(this.options.privateKey);
    return { token, expiresIn: this.options.ttlSeconds };
  }

  /**
   * Wave 1e: a short-lived "password was right, a code is still owed" token. Same key and issuer as a
   * session token but a DIFFERENT audience (`<audience>:mfa-challenge`), `typ: mfa-challenge+jwt` and no
   * `kind`/`roles`/`sid`, so neither `JwtVerifier` nor admin-web can mistake it for a session.
   */
  async issueChallenge(
    claims: MfaChallengeClaims,
    ttlSeconds?: number,
    purpose: MfaChallengePurpose = DEFAULT_CHALLENGE_PURPOSE,
  ): Promise<{ token: string; expiresIn: number; jti: string }> {
    const spec = CHALLENGE_SPECS[purpose];
    const ttl = ttlSeconds ?? spec.defaultTtlSeconds;
    const { kid } = await this.publicJwk;
    const nowSeconds = Math.floor((this.options.now?.() ?? new Date()).getTime() / 1000);
    const jti = randomUUID();
    const token = await new SignJWT({
      purpose,
      tenant_id: claims.tenantId,
      email: claims.email,
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: spec.typ,
        ...(kid === undefined ? {} : { kid }),
      })
      .setSubject(claims.sub)
      .setIssuer(this.options.issuer)
      .setAudience(this.challengeAudience(purpose))
      .setJti(jti)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + ttl)
      .sign(this.options.privateKey);
    return { token, expiresIn: ttl, jti };
  }

  /**
   * The challenge's claims, or `null` for anything wrong with it (expired, forged, wrong kind, or a
   * challenge of the OTHER purpose) — never throws. Only the requested `purpose` is accepted.
   */
  async verifyChallenge(
    token: string,
    purpose: MfaChallengePurpose = DEFAULT_CHALLENGE_PURPOSE,
  ): Promise<(MfaChallengeClaims & { jti: string }) | null> {
    try {
      const spec = CHALLENGE_SPECS[purpose];
      const { payload } = await jwtVerify(token, createLocalJWKSet(await this.jwks()), {
        issuer: this.options.issuer,
        audience: this.challengeAudience(purpose),
        typ: spec.typ,
        algorithms: ["ES256"],
        clockTolerance: CHALLENGE_CLOCK_TOLERANCE_SECONDS,
        currentDate: this.options.now?.() ?? new Date(),
      });
      const { sub, jti } = payload;
      const tenantId = payload["tenant_id"];
      const email = payload["email"];
      if (
        payload["purpose"] !== purpose ||
        typeof sub !== "string" ||
        sub.length === 0 ||
        typeof jti !== "string" ||
        jti.length === 0 ||
        typeof tenantId !== "string" ||
        tenantId.length === 0 ||
        typeof email !== "string" ||
        email.length === 0
      )
        return null;
      return { sub, tenantId, email, jti };
    } catch {
      return null;
    }
  }

  private challengeAudience(purpose: MfaChallengePurpose): string {
    return `${this.options.audience}:${CHALLENGE_SPECS[purpose].audienceSuffix}`;
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: [await this.publicJwk] };
  }
}

/** `getKey` for `JwtVerifier` that verifies against this issuer's own public key — no HTTP fetch. */
export async function localKeyResolver(issuer: NativeTokenIssuer): Promise<JWTVerifyGetKey> {
  return createLocalJWKSet(await issuer.jwks());
}
