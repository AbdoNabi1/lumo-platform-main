import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import {
  SignJWT,
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
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

  async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: [await this.publicJwk] };
  }
}

/** `getKey` for `JwtVerifier` that verifies against this issuer's own public key — no HTTP fetch. */
export async function localKeyResolver(issuer: NativeTokenIssuer): Promise<JWTVerifyGetKey> {
  return createLocalJWKSet(await issuer.jwks());
}
