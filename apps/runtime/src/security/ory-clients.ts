import { KetoRelationshipClient, KratosIdentityService } from "@platform/auth";
import type { AuditEvent, AuditTrail } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import type { RuntimeCore } from "../composition";

/**
 * Audit sink that records `AuditTrail` events to the structured logger (H-2). It backs the reused
 * `KratosIdentityService`, whose session revocations are ALSO WORM-audited by Security itself
 * (`RevokeAllSessions`) — this is the enforcement-side record, shipped to the log/SIEM pipeline. A real
 * sink, not a placeholder; the durable outbox-backed `AuditTrail` (ADR-0009) replaces it behind the
 * same port when the audit-archival slice lands.
 */
export class LoggingAuditTrail implements AuditTrail {
  constructor(private readonly logger: Logger) {}
  record(event: AuditEvent): Promise<void> {
    this.logger.info("audit", { ...event });
    return Promise.resolve();
  }
}

/** The live Ory clients (Keto ReBAC + Kratos identity/session) shared by every Security runtime binding. */
export interface OryClients {
  readonly keto: KetoRelationshipClient;
  readonly kratos: KratosIdentityService;
}

/**
 * Constructs the Security context's live Ory clients from the shared {@link RuntimeCore} (H-2 / G-SEC-4).
 * The **one** place the `@platform/auth` Keto/Kratos clients are built for the runtime, so the identity
 * consumer fleet (`wireSecurityIdentity`) and the Prisma-backed Security composition
 * (`wireSecurityRuntime`, P2.0.2) share exactly one client construction — no duplicate Ory client, no
 * drift. Returns `null` when the Ory URLs are unset (`APP_ENV=local`), the fail-closed local escape hatch
 * mirrored from the config schema (the caller then runs without the live binding).
 */
export function buildOryClients(core: RuntimeCore): OryClients | null {
  const { config } = core;
  if (
    config.KETO_READ_URL === undefined ||
    config.KETO_WRITE_URL === undefined ||
    config.KRATOS_PUBLIC_URL === undefined ||
    config.KRATOS_ADMIN_URL === undefined
  ) {
    return null;
  }

  const fetchFn = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => fetch(url, init);

  const keto = new KetoRelationshipClient({
    readUrl: config.KETO_READ_URL,
    writeUrl: config.KETO_WRITE_URL,
    fetch: fetchFn,
    logger: core.logger,
  });
  const kratos = new KratosIdentityService({
    publicUrl: config.KRATOS_PUBLIC_URL,
    adminUrl: config.KRATOS_ADMIN_URL,
    fetch: fetchFn,
    cache: core.redis.cache,
    auditTrail: new LoggingAuditTrail(core.logger),
    clock: core.clock,
    logger: core.logger,
  });
  return { keto, kratos };
}
