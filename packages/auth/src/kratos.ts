import type {
  AuditTrail,
  AuthenticatedContext,
  Cache,
  ClaimsAuthenticator,
  Clock,
  AuthenticatedIdentity,
  PrincipalKind,
} from "@platform/contracts";
import type { Logger } from "@platform/utils";

/** Minimal fetch shape — injectable so contract tests run without any Ory runtime. */
export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface KratosOptions {
  /** Kratos public API base (session whoami). */
  readonly publicUrl: string;
  /** Kratos admin API base (identity lookup, session revocation) — mesh-internal ONLY. */
  readonly adminUrl: string;
  readonly fetch: HttpFetch;
  readonly cache: Cache;
  /** Session-validation cache TTL; the revocation-latency window (D-048). Default 15s. */
  readonly sessionCacheTtlSeconds?: number;
  readonly auditTrail: AuditTrail;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface KratosSession {
  readonly id: string;
  readonly active?: boolean;
  readonly identity?: {
    readonly id: string;
    readonly metadata_public?: {
      readonly kind?: string;
      readonly roles?: readonly string[];
      readonly tenant_id?: string;
    };
    readonly traits?: Record<string, unknown>;
  };
}

/**
 * Ory Kratos adapters (Sprint 2.7, D-048) over the REST API — deliberately **no Ory SDK**: the
 * surface we use is three endpoints, and raw REST keeps the dependency graph clean and the
 * contract testable with an injected fetch.
 *
 * Boundary honesty about self-service flows: registration, login, logout, password reset,
 * email verification, MFA, social/OIDC (and SAML via upstream IdP) are **Kratos-owned
 * self-service flows** — browser redirects against Kratos's public API, configured (not coded)
 * in Kratos. The platform's job is exactly what this adapter does: validate sessions, look up
 * identities, revoke sessions, and audit. Reimplementing flow orchestration server-side would
 * duplicate Kratos and re-own its attack surface. Login/logout audit events arrive via Kratos
 * webhooks into the audit trail (seam documented; wired with the webhook receiver on the
 * transport). MFA/WebAuthn/passkeys are Kratos flow configuration — session validation here is
 * unchanged by them, which is the point of the seam.
 */
export class KratosSessionAuthenticator implements ClaimsAuthenticator {
  private readonly options: KratosOptions;

  constructor(options: KratosOptions) {
    this.options = options;
  }

  async verify(token: string): Promise<AuthenticatedIdentity | null> {
    const context = await this.verifyWithClaims(token);
    return context?.principal ?? null;
  }

  async verifyWithClaims(token: string): Promise<AuthenticatedContext | null> {
    const cacheKey = `kratos:session:${token}`;
    try {
      const cached = await this.options.cache.get<AuthenticatedContext>(cacheKey);
      if (cached !== null) return cached;
    } catch {
      // cache outage degrades to Kratos
    }

    const response = await this.options.fetch(`${this.options.publicUrl}/sessions/whoami`, {
      headers: { "X-Session-Token": token },
    });
    if (response.status !== 200) {
      return null;
    }
    const session = (await response.json()) as KratosSession;
    if (session.active !== true || session.identity === undefined) {
      return null;
    }

    const meta = session.identity.metadata_public ?? {};
    const kind: PrincipalKind =
      meta.kind === "staff" || meta.kind === "service" ? meta.kind : "customer";
    const context: AuthenticatedContext = {
      principal: {
        id: session.identity.id,
        kind,
        roles: [...(meta.roles ?? [])],
      },
      claims: {
        session_id: session.id,
        tenant_id: meta.tenant_id,
        ...session.identity.traits,
      },
    };
    try {
      await this.options.cache.set(cacheKey, context, this.options.sessionCacheTtlSeconds ?? 15);
    } catch {
      // population failure is harmless
    }
    return context;
  }
}

/** Server-side identity operations (admin API — mesh-internal). Every mutation is audited. */
export class KratosIdentityService {
  private readonly options: KratosOptions;

  constructor(options: KratosOptions) {
    this.options = options;
  }

  async lookupIdentity(identityId: string): Promise<Record<string, unknown> | null> {
    const response = await this.options.fetch(
      `${this.options.adminUrl}/admin/identities/${encodeURIComponent(identityId)}`,
    );
    return response.status === 200 ? ((await response.json()) as Record<string, unknown>) : null;
  }

  /** Revokes ALL of an identity's sessions (logout-everywhere / compromise response). */
  async revokeSessions(identityId: string, revokedBy: AuthenticatedIdentity): Promise<boolean> {
    const response = await this.options.fetch(
      `${this.options.adminUrl}/admin/identities/${encodeURIComponent(identityId)}/sessions`,
      { method: "DELETE" },
    );
    const succeeded = response.status === 204;
    await this.options.auditTrail.record({
      principalId: revokedBy.id,
      principalKind: revokedBy.kind,
      permission: "identity:revoke_sessions",
      decision: succeeded ? "allow" : "deny",
      occurredAt: this.options.clock.now().toISOString(),
      metadata: { targetIdentityId: identityId },
    });
    if (!succeeded) {
      this.options.logger.error("kratos session revocation failed", {
        identityId,
        status: response.status,
      });
    }
    return succeeded;
  }
}
