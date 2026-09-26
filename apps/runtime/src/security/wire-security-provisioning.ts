import {
  KafkaMessageProducer,
  type MessagingMetrics,
  type SupervisedConsumer,
} from "@platform/kafka";
import type { EventHandler } from "@platform/messaging";
import type { RuntimeCore } from "../composition";
import { wireSecurityRuntime } from "./wire-security-runtime";
import { buildProcessedConsumer } from "./consumer-runtime";
import { bootstrapSecurity } from "./bootstrap-security";
import {
  AssignRoleOnMembershipCreated,
  DisablePrincipalOnUserDeactivated,
  ProvisionPrincipalOnUserCreated,
} from "./security-provisioning.consumers";

export interface WiredSecurityProvisioning {
  /** The live consumer fleet the worker supervises. */
  readonly runtimes: readonly SupervisedConsumer[];
  /** The Kafka producer (retry/DLQ) the entrypoint disconnects on shutdown. */
  readonly producer: KafkaMessageProducer;
}

/**
 * Production wiring for Security **principal provisioning** (P2.0.2 blockers A/B/D/E). Provisions the
 * baseline security model (roles + balanced zero-trust policy + tenant profile — `bootstrapSecurity`,
 * idempotent) and registers the three principal-provisioning consumers
 * (`security-provisioning.consumers.ts`) so the Security principal/role-assignment store is populated
 * from the already-published `identity.*` events, using the SAME reliability envelope
 * (`buildProcessedConsumer`: tx-scoped inbox idempotency, retry topics, DLQ) the H-2 identity-projection
 * fleet already uses. Reuse-only — no new use-cases, no new adapters.
 *
 * Config-gated behind `SECURITY_PRINCIPAL_PROVISIONING` (default `off`): returns `null` immediately, so
 * no current deployment or test is affected. This populates the Security store; it does not mount any
 * HTTP enforcement — `AdminGuard` + Keto remains the authorization point until `SECURITY_ZERO_TRUST_
 * ENFORCEMENT` is (separately, deliberately) mounted, see HIGH_01_REPORT.md.
 */
export async function wireSecurityProvisioning(
  core: RuntimeCore,
  metrics?: MessagingMetrics,
): Promise<WiredSecurityProvisioning | null> {
  if (!core.config.SECURITY_PRINCIPAL_PROVISIONING) return null;

  const wired = wireSecurityRuntime(core);
  await bootstrapSecurity(wired.security, core.config.TENANT_DEFAULT_ID, core.logger);

  const producer = new KafkaMessageProducer(core.kafka);
  // G-64: the consumers take their tenant from each message's envelope. `bootstrapSecurity` above is
  // the one deliberate exception (boot-time baseline for the deployment tenant; per-tenant
  // provisioning is T10.6), which is why the worker guard still names it under multi.
  const deps = { security: wired.security, logger: core.logger };
  const build = <T>(handler: EventHandler<T>, consumerGroup: string): SupervisedConsumer =>
    buildProcessedConsumer<T>(core, handler, consumerGroup, producer, metrics);

  const runtimes: readonly SupervisedConsumer[] = [
    build(new ProvisionPrincipalOnUserCreated(deps), "security.principal-provisioning"),
    build(new DisablePrincipalOnUserDeactivated(deps), "security.principal-provisioning"),
    build(new AssignRoleOnMembershipCreated(deps), "security.principal-provisioning"),
  ];

  return { runtimes, producer };
}
