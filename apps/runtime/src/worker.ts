import { ConsumerSupervisor, KafkaMessageProducer } from "@platform/kafka";
import { logger } from "@platform/utils";
import { loadRuntimeConfig, type RuntimeConfig } from "./config";
import {
  buildPaymentCapturedRuntime,
  buildRuntimeCore,
  buildTrackingIngestRuntime,
  type RuntimeCore,
} from "./composition";
import { buildFinanceSettlementConsumerRuntimes } from "./consumers/finance-settlement.consumers";
import { buildOrdersPaidConsumerRuntimes } from "./consumers/orders-paid.consumers";
import { assertWorkerTenantModeSupported } from "./tenant-mode-guard";
import { startHealthServer } from "./health-server";
import { startOutboxRelay } from "./outbox-relay-runtime";
import { wireSecurityProvisioning } from "./security/wire-security-provisioning";
import { startRuntimeTelemetry } from "./telemetry";

/**
 * Worker entrypoint (Sprint 2.9): the Kafka consumer fleet under the `ConsumerSupervisor`
 * (health = readiness; lag via admin), starting with the platform's first real cross-context
 * flow — `payments.payment_intent.captured` → `MarkOrderPaid` over the PRODUCTION Prisma slice
 * (tx-scoped outbox, Postgres inbox idempotency, retry topics, DLQ topic + row).
 *
 * The Temporal worker joins this process when its activities become composable — blocked
 * honestly on: a price-quote use case (read side, G-8), the ADR-0013 reservation-commit
 * implementation, and payments carrying the checkout-session ref for the signal bridge
 * (ADR-0012 follow-up, G-40). Registering a worker whose activities cannot exist would be a
 * fake adapter, which this codebase does not do.
 */
export async function startWorker(
  config: RuntimeConfig,
  core?: RuntimeCore,
): Promise<ConsumerSupervisor> {
  // T10.4: multi mode is possible for the API (per-request resolution) but not for this process —
  // its consumers are pinned to TENANT_DEFAULT_ID until G-64. Refuse BEFORE building anything.
  assertWorkerTenantModeSupported(config.TENANT_MODE);
  const runtime = core ?? buildRuntimeCore(config);
  // H-03: see api.ts — same activation, this process's role suffix.
  const telemetry = startRuntimeTelemetry(config, "worker");
  const supervisor = new ConsumerSupervisor(runtime.kafka, runtime.logger);
  supervisor.register(buildPaymentCapturedRuntime(runtime));

  // C-2 (Task 17b): nothing subscribed to `orders.order.paid` anywhere in this repo, so a paid
  // order posted no ledger entry (Finance's `OrdersPaidConsumer` had zero callers), earned no
  // loyalty points, updated no customer profile, and created no confirmation notification (the
  // delivery half — QueueNotification/SendNotification — is still a separately-tracked gap, since
  // every delivery provider in this codebase remains an in-memory stub).
  //
  // WHICH orders actually reach these four, stated plainly because the obvious reading is wrong:
  // ONLY orders that reach `paid`/`payment_received` via the LEGACY `PlaceOrder` + admin-mark-paid
  // path, because `orders.order.paid` is raised solely by `markPaid`/`completePayment`
  // (`services/orders/src/domain/order.ts`). Orders created by the checkout flow
  // (`CreateOrderFromCheckout` → `Order.createFromCheckout`) sit at status `created` and never
  // transition further under any code path that exists today, so NONE of these four fire for the
  // checkout flow. That is an OPEN C-2 sub-gap awaiting a product decision on how payment capture
  // integrates with checkout completion — not something to close by fabricating a payment
  // reference, which would push wrong-but-plausible entries into Finance's ledger. The current
  // behavior is regression-pinned by
  // `apps/admin/src/http/cart-checkout-pricing-security.e2e.test.ts`; full reasoning in
  // `api.ts`'s `assertProductionIntegrationPortsConfigured` doc comment.
  //
  // Registered UNCONDITIONALLY, unlike the two gated blocks below: those depend on external
  // infrastructure (Ory, a seeded tracking registry) that is genuinely absent in some environments,
  // whereas these four need only Kafka + Prisma — always present wherever the worker runs at all.
  // Same reasoning as `buildPaymentCapturedRuntime` above, the closest sibling, which is also
  // ungated; a flag here would be a speculative switch whose "off" position is a silently broken
  // paid-order flow.
  for (const consumerRuntime of buildOrdersPaidConsumerRuntimes(runtime, runtime.metrics)) {
    supervisor.register(consumerRuntime);
  }

  // WP-11 (F-11): `PaymentsCapturedConsumer`/`RefundsIssuedConsumer` (`services/finance`) had zero
  // callers — every captured payment posted no fee entry and every issued refund posted no contra
  // entry, silently. Registered unconditionally, same reasoning as `buildOrdersPaidConsumerRuntimes`
  // just above: needs only Kafka + Prisma, always present wherever the worker runs at all.
  for (const consumerRuntime of buildFinanceSettlementConsumerRuntimes(runtime, runtime.metrics)) {
    supervisor.register(consumerRuntime);
  }

  // C-07: the consumer of `tracking.event.captured.v1`. Until this line the collector published to
  // that topic and nothing subscribed — every beacon was accepted, written to Kafka and aged out
  // unprocessed. Config-gated (`TRACKING_INGEST_ENABLED`, default off) because the registry must be
  // seeded first; `buildTrackingIngestRuntime` returns null when it is off.
  const trackingIngest = await buildTrackingIngestRuntime(runtime);
  if (trackingIngest !== null) supervisor.register(trackingIngest);

  // H-04: bootstrapSecurity + the three principal-provisioning consumers (security-provisioning.
  // consumers.ts) had zero callers — the Security principal/role store was never populated from
  // Identity events. Config-gated (`SECURITY_PRINCIPAL_PROVISIONING`, default off); returns null when
  // it is off, same convention as buildTrackingIngestRuntime above.
  const securityProvisioning = await wireSecurityProvisioning(runtime, runtime.metrics);
  if (securityProvisioning !== null) {
    for (const consumerRuntime of securityProvisioning.runtimes)
      supervisor.register(consumerRuntime);
  }

  runtime.health.register(supervisor.healthCheck());

  await supervisor.startAll();

  // C-8: the publishing half of the outbox pattern. Without this the rows every repository writes
  // inside its aggregate transaction are never delivered to anyone.
  const outboxProducer = new KafkaMessageProducer(runtime.kafka);
  await outboxProducer.connect();
  const outboxRelay = startOutboxRelay(runtime, outboxProducer);

  // F5/F3: the worker serves no business traffic, so it has no Fastify server — but its k8s manifest
  // probes /healthz + /readyz and Prometheus scrapes /metrics on the same port (21-deployment-worker
  // .yaml). Without this surface the pod never becomes ready and liveness eventually kills it, and the
  // `messaging_messages_*_total` series (emitted in THIS process) would be unscrapeable.
  const health = startHealthServer(runtime.health, config.PORT, runtime.metrics);

  logger.info("worker started", { consumers: supervisor.status().length, env: config.APP_ENV });

  const shutdown = async (): Promise<void> => {
    logger.info("worker shutting down");
    health.close();
    outboxRelay?.stop();
    await outboxProducer.disconnect();
    await supervisor.stopAll();
    await runtime.redis.disconnect();
    await runtime.prisma.$disconnect();
    await telemetry.shutdown();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  return supervisor;
}

if (process.argv[1]?.endsWith("worker.ts") || process.argv[1]?.endsWith("worker.js")) {
  startWorker(loadRuntimeConfig()).catch((error: unknown) => {
    logger.error("worker failed to start", { error: String(error) });
    process.exitCode = 1;
  });
}
