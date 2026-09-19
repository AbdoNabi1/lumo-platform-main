import {
  PrismaConsentProjectionStore,
  PrismaIdentityProjectionStore,
  wireSecurity,
  type SecurityWiringDeps,
  type WiredSecurity,
} from "@platform/security";
import type { PermissionGuard } from "@platform/http";
import type { RuntimeCore } from "../composition";
import { buildOryClients } from "./ory-clients";
import {
  KetoRelationshipCheck,
  KratosIdentityDirectory,
  KratosSessionRevoker,
} from "./ory-adapters";
import { wireSecurityProviders } from "./wire-security-providers";
import { wireSecurityEdge } from "./wire-security-edge";

/**
 * Composition root for the **Prisma-backed Security context at runtime** (P2.0.2, blocker A/D/E/F). Until
 * now `wireSecurity` — the context's full composition (every use-case + the `SecurityController` +
 * the `SecuritySdk`/decider) — was never invoked in `apps/runtime`; only boot verification + the
 * telemetry/edge shell ran. This wires the durable Postgres slice (G-SEC-1) with the live Ory identity
 * binding (H-2), the cloud KMS/crypto/threat providers (H-3), and the Prisma consent + identity
 * projections, so the runtime finally has a live decision + provisioning surface.
 *
 * Reuse-only: no new use-cases, no new adapters — it binds the EXISTING context composition and the
 * EXISTING runtime adapters (`KratosIdentityDirectory`, `KetoRelationshipCheck`, `KratosSessionRevoker`,
 * the Prisma projection stores, `wireSecurityProviders`). The Ory adapters are omitted when their URLs are
 * unset (`APP_ENV=local`); the context then falls back to its offline reference adapters, exactly as the
 * H-2 identity consumer fleet does. Side-effect-free (lazy clients) → testable without Docker.
 *
 * The **same system principal** the H-2 session-revocation binding uses (a non-human `service` identity)
 * authorises enforcement-side session revocation.
 */
const SYSTEM_PRINCIPAL = { id: "security-runtime", kind: "service" as const, roles: [] as const };

export function wireSecurityRuntime(core: RuntimeCore): WiredSecurity {
  const { config } = core;
  if (config.DATABASE_URL.trim().length === 0) {
    // Fail closed: the Security context is Postgres-backed (principals/roles/policies/sessions/audit).
    throw new Error("wireSecurityRuntime requires DATABASE_URL (Security is Postgres-backed).");
  }

  const providers = wireSecurityProviders({ config, logger: core.logger });
  const ory = buildOryClients(core);

  const deps: SecurityWiringDeps = {
    serializer: core.serializer,
    idGenerator: core.idGenerator,
    clock: core.clock,
    prisma: core.prisma,
    // H-2 live identity binding — present outside local; absent ⇒ the context's offline reference adapters.
    ...(ory !== null
      ? {
          identityDirectory: new KratosIdentityDirectory(ory.kratos),
          relationshipCheck: new KetoRelationshipCheck(ory.keto),
          sessionRevocation: new KratosSessionRevoker(ory.kratos, SYSTEM_PRINCIPAL),
        }
      : {}),
    // Shared Prisma projections the resolution use-cases read + the identity/consent consumers write (H-2).
    consentStore: new PrismaConsentProjectionStore({
      prisma: core.prisma,
      idGenerator: core.idGenerator,
    }),
    identityProjection: new PrismaIdentityProjectionStore({
      prisma: core.prisma,
      idGenerator: core.idGenerator,
    }),
    // H-3 cloud KMS/crypto/threat providers — undefined ⇒ the context's node:crypto + reference feed.
    ...(providers.kms !== undefined ? { kms: providers.kms } : {}),
    ...(providers.crypto !== undefined ? { crypto: providers.crypto } : {}),
    ...(providers.threatIntel !== undefined ? { threatIntel: providers.threatIntel } : {}),
  };

  return wireSecurity(deps);
}

/**
 * Builds the **zero-trust HTTP authorization guard** (P2.0.2 blocker C). It composes the Prisma-backed
 * Security context for its `SecuritySdk` (the `ZeroTrustDecider` over `EvaluateAccess`), then binds it to
 * the existing H-4 edge (`wireSecurityEdge` → OTel telemetry + instrumentation + edge cache) with the
 * resilient threat resolver. The returned `PermissionGuard` drops into the admin HTTP transport's single
 * authorization seam. Reuse-only: the guard, evaluator, telemetry and threat fan-out all already exist —
 * this is the wiring that was missing. The edge only *enforces* the decision; the context decides (ADR-0023).
 */
export function buildSecurityHttpGuard(core: RuntimeCore): PermissionGuard {
  const wired = wireSecurityRuntime(core);
  const providers = wireSecurityProviders({ config: core.config, logger: core.logger });
  const edge = wireSecurityEdge({
    logger: core.logger,
    sessionTtlSeconds: core.config.SECURITY_SESSION_MIRROR_TTL_SECONDS,
  });
  // P2.0.3 (ADR-0031): the same SDK also federates the request's IdP `sid` into a Security session, which
  // is what lets a human principal satisfy `EvaluateAccess`'s session gate — Kratos mints human logins,
  // Security mirrors them on first sight. Without this the guard denies every human, correctly but uselessly.
  return edge.buildGuard(wired.sdk, providers.threatIntel, wired.sdk);
}
