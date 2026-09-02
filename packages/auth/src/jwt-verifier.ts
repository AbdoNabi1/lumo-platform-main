import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type {
  AuthenticatedContext,
  ClaimsAuthenticator,
  Principal,
  PrincipalKind,
} from "@platform/contracts";
import type { Logger } from "@platform/utils";

export interface JwtVerifierOptions {
  /** Expected `iss` — tokens from any other issuer are rejected. */
  readonly issuer: string;
  /** Expected `aud`. */
  readonly audience: string;
  /** Tolerated clock skew (seconds). Default 30. */
  readonly clockToleranceSeconds?: number;
  /**
   * JWKS endpoint of the issuer (Kratos/Hydra). Keys are fetched lazily and re-fetched on
   * unknown `kid` — that IS key rotation support: the issuer rotates, we pick up the new key on
   * first sight, old tokens verify until their own expiry.
   */
  readonly jwksUrl?: string;
  /** Injected key resolver for tests / non-JWKS setups (takes precedence over `jwksUrl`). */
  readonly getKey?: JWTVerifyGetKey;
  readonly logger: Logger;
}

/**
 * JWKS-based `ClaimsAuthenticator` (Sprint 2.7, D-048). Verifies signature, `iss`, `aud`,
 * `exp`/`nbf` (with bounded clock tolerance) and maps claims onto the platform `Principal`:
 * `sub` → id, `kind` → principal kind (default `customer`), `roles` → roles. Tenant
 * (`tenant_id`) and scopes ride the returned claims for the transport's resolvers — this
 * adapter never decides tenancy or permissions itself. Replay protection: JWTs are bearer
 * tokens bounded by `exp`; request-level replay is the Idempotency-Key layer (Sprint 2.6);
 * one-time-use semantics belong to the issuer (Kratos session tokens / Hydra refresh rotation —
 * refresh tokens NEVER reach this verifier, rotation is the issuer's contract).
 *
 * Invalid tokens resolve `null` (never throw): the transport maps null → 401 uniformly, which
 * also keeps timing behavior flat across "bad signature" vs "expired" vs "wrong audience".
 */
export class JwtVerifier implements ClaimsAuthenticator {
  private readonly options: JwtVerifierOptions;
  private readonly getKey: JWTVerifyGetKey;

  constructor(options: JwtVerifierOptions) {
    this.options = options;
    if (options.getKey !== undefined) {
      this.getKey = options.getKey;
    } else if (options.jwksUrl !== undefined) {
      this.getKey = createRemoteJWKSet(new URL(options.jwksUrl));
    } else {
      throw new Error("JwtVerifier: either jwksUrl or getKey is required.");
    }
  }

  async verify(token: string): Promise<Principal | null> {
    const context = await this.verifyWithClaims(token);
    return context?.principal ?? null;
  }

  async verifyWithClaims(token: string): Promise<AuthenticatedContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        clockTolerance: this.options.clockToleranceSeconds ?? 30,
      });
      const principal = toPrincipal(payload);
      if (principal === null) {
        return null;
      }
      return { principal, claims: payload };
    } catch (error) {
      this.options.logger.debug("jwt verification failed", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      return null;
    }
  }
}

const PRINCIPAL_KINDS: readonly PrincipalKind[] = ["customer", "staff", "service"];

function toPrincipal(payload: JWTPayload): Principal | null {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return null;
  }
  const kindClaim = payload["kind"];
  const kind = PRINCIPAL_KINDS.includes(kindClaim as PrincipalKind)
    ? (kindClaim as PrincipalKind)
    : "customer";
  const rolesClaim = payload["roles"];
  const roles = Array.isArray(rolesClaim)
    ? rolesClaim.filter((role): role is string => typeof role === "string")
    : [];
  return { id: payload.sub, kind, roles };
}
