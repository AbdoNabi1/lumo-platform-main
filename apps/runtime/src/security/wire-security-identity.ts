import {
  KafkaMessageProducer,
  type MessagingMetrics,
  type SupervisedConsumer,
} from "@platform/kafka";
import type { EventHandler } from "@platform/messaging";
import {
  ConsentChangedConsumer,
  IdentityMembershipCreatedConsumer,
  IdentityMembershipRoleChangedConsumer,
  IdentityOrganizationCreatedConsumer,
  IdentityUserCreatedConsumer,
  IdentityUserDeactivatedConsumer,
  PrismaConsentProjectionStore,
  PrismaIdentityProjectionStore,
  ProjectionConsentPort,
  RelationDeletedConsumer,
  RelationWrittenConsumer,
  SessionRevokedAllConsumer,
  type ConsentProjectionStore,
  type IdentityProjectionStore,
} from "@platform/security";
import type { RuntimeCore } from "../composition";
import { buildOryClients } from "./ory-clients";
import { buildProcessedConsumer } from "./consumer-runtime";
import { KetoRelationshipSync, KratosSessionRevoker } from "./ory-adapters";

export interface WiredSecurityIdentity {
  /** The live consumer fleet the supervisor starts (consent projection + relation/session sync). */
  readonly runtimes: readonly SupervisedConsumer[];
  /** The Kafka producer (retry/DLQ) the entrypoint disconnects on shutdown. */
  readonly producer: KafkaMessageProducer;
  /** The consent projection store (Postgres) the security service's ConsentPort reads (API side). */
  readonly consentStore: ConsentProjectionStore;
  /** The consent read port for the security service composition when it is mounted. */
  readonly consent: ProjectionConsentPort;
  /** The Identity projection store (Postgres) the security service's resolution use-cases read (API side). */
  readonly identityProjection: IdentityProjectionStore;
}

/**
 * Production wiring for the Security context's **live identity binding** (H-2 / G-SEC-4). It reuses the
 * `@platform/auth` Ory clients (Keto relation tuples + Kratos identity/session) and the existing
 * consumer runtime (tx-scoped inbox idempotency + retry topics + DLQ, ADR-0005) — no new event runtime,
 * no new Ory client. Returns the consumer fleet the worker supervises:
 *
 * - `identity.customer.consent_changed` → the Postgres consent projection (consent read wired to events);
 * - `security.relation.written` / `.deleted` → Keto relation-tuple sync (relationship synchronization);
 * - `security.session.revoked_all` → Kratos session revocation (session synchronization).
 *
 * Requires the Ory URLs (fail-closed outside `local`, enforced by the config schema); returns `null`
 * when they are absent so the worker cleanly runs without the live binding in local dev.
 */
export function wireSecurityIdentity(
  core: RuntimeCore,
  metrics?: MessagingMetrics,
): WiredSecurityIdentity | null {
  const { config } = core;
  const ory = buildOryClients(core);
  if (ory === null) {
    core.logger.warn("security live identity binding disabled: Ory URLs unset (APP_ENV=local)");
    return null;
  }
  const { keto, kratos } = ory;

  const consentStore = new PrismaConsentProjectionStore({
    prisma: core.prisma,
    idGenerator: core.idGenerator,
  });
  const consent = new ProjectionConsentPort(consentStore);
  const identityProjection = new PrismaIdentityProjectionStore({
    prisma: core.prisma,
    idGenerator: core.idGenerator,
  });
  const relationshipSync = new KetoRelationshipSync(keto);
  // The system principal on whose behalf enforcement revocations are audited (non-human, service kind).
  const systemPrincipal = { id: "security-runtime", kind: "service" as const, roles: [] };
  const sessionRevocation = new KratosSessionRevoker(kratos, systemPrincipal);

  const producer = new KafkaMessageProducer(core.kafka);
  const build = <T>(handler: EventHandler<T>, consumerGroup: string): SupervisedConsumer =>
    buildProcessedConsumer<T>(core, handler, consumerGroup, producer, metrics);

  // ADR-0014 (WP-10, T10.3) — class D / G-64: the projection stores take `tenantId` per call, but the
  // event envelope carries no required tenant yet, so the consumers are handed the deployment tenant
  // here (T10.7 inventory). Reading the envelope tenant per message is the separate G-64 fix.
  const tenantId = config.TENANT_DEFAULT_ID;
  const idp = { store: identityProjection, logger: core.logger, tenantId };
  const runtimes: readonly SupervisedConsumer[] = [
    build(
      new ConsentChangedConsumer({ store: consentStore, logger: core.logger, tenantId }),
      "security.consent-projection",
    ),
    build(
      new RelationWrittenConsumer({ sync: relationshipSync, logger: core.logger }),
      "security.relation-sync",
    ),
    build(
      new RelationDeletedConsumer({ sync: relationshipSync, logger: core.logger }),
      "security.relation-sync",
    ),
    build(
      new SessionRevokedAllConsumer({ sessionRevocation, logger: core.logger }),
      "security.session-sync",
    ),
    // Identity projection (principal / membership / organization resolution).
    build(new IdentityUserCreatedConsumer(idp), "security.identity-projection"),
    build(new IdentityUserDeactivatedConsumer(idp), "security.identity-projection"),
    build(new IdentityOrganizationCreatedConsumer(idp), "security.identity-projection"),
    build(new IdentityMembershipCreatedConsumer(idp), "security.identity-projection"),
    build(new IdentityMembershipRoleChangedConsumer(idp), "security.identity-projection"),
  ];

  return { runtimes, producer, consentStore, consent, identityProjection };
}
