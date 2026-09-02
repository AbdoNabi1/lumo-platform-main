/**
 * Collector entrypoint — the composition root.
 *
 * Every dependency is real. There is no in-memory publisher fallback and no permissive default: a
 * collector that starts with a stub publisher would answer `202 Accepted` to every beacon while
 * dropping the traffic on the floor, and nothing downstream would notice, because "no events" and
 * "no traffic" look identical in every dashboard.
 */

import { createKafkaClient, KafkaMessageProducer } from "@platform/kafka";
import { JsonEventSerializer } from "@platform/domain-events";
import { HealthRegistry } from "@platform/health";
import { CryptoIdGenerator } from "@platform/id";
import { SystemClock } from "@platform/clock";
import { createLogger } from "@platform/utils";

import { CollectorEndpoint } from "./collector-endpoint";
import { createCollectorServer } from "./server";
import { WriteKeyRegistry, parseWriteKeyBindings } from "./write-key-registry";

/** Reads a required variable, failing at boot rather than at the first request. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`collector: ${name} is required`);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const logger = createLogger({ scope: "collector" });

  const writeKeys = new WriteKeyRegistry(parseWriteKeyBindings(required("COLLECTOR_WRITE_KEYS")));

  // How many proxies WE operate in front of this collector. Defaults to 0, which ignores
  // X-Forwarded-For entirely — the safe reading, because a wrong non-zero value makes the client IP
  // attacker-controlled. Set it deliberately to match the real topology.
  const trustedProxyCount = Number(process.env["COLLECTOR_TRUSTED_PROXIES"] ?? "0");
  if (!Number.isInteger(trustedProxyCount) || trustedProxyCount < 0) {
    throw new Error("collector: COLLECTOR_TRUSTED_PROXIES must be a non-negative integer");
  }

  const allowedOrigins = required("COLLECTOR_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  if (allowedOrigins.includes("*")) {
    throw new Error(
      "collector: COLLECTOR_ALLOWED_ORIGINS must not contain '*' — a wildcard cannot be combined " +
        "with credentialed CORS, and the first-party session cookies would silently stop flowing",
    );
  }

  // The shared client factory, not a bespoke `new Kafka(...)`: client id, broker parsing and log
  // level stay consistent with every other producer in the platform.
  const kafka = createKafkaClient({
    clientId: "tracking-collector",
    brokers: required("KAFKA_BROKERS")
      .split(",")
      .map((broker) => broker.trim()),
  });
  const publisher = new KafkaMessageProducer(kafka);
  // Connect at boot: a broker that is unreachable should fail the deploy, not surface as a 503 on
  // the first real visitor.
  await publisher.connect();

  const health = new HealthRegistry();
  // H-07: without this, `/readyz` reported healthy unconditionally — a collector whose Kafka
  // producer had died still advertised readiness and accepted beacons it could not publish.
  health.register({
    name: "kafka-producer",
    probe: async () => {
      if (!publisher.isConnected) {
        throw new Error("kafka producer is not connected");
      }
    },
  });

  const endpoint = new CollectorEndpoint({
    writeKeys,
    idGenerator: new CryptoIdGenerator(),
    clock: new SystemClock(),
    ipPolicy: { trustedProxyCount },
    publisher,
    serializer: new JsonEventSerializer(),
    logger,
  });

  const app = createCollectorServer({
    endpoint,
    health,
    allowedOrigins,
    secureCookies: (process.env["COLLECTOR_SECURE_COOKIES"] ?? "true") !== "false",
    ...(process.env["COLLECTOR_COOKIE_DOMAIN"] === undefined
      ? {}
      : { cookieDomain: process.env["COLLECTOR_COOKIE_DOMAIN"] }),
  });

  const port = Number(process.env["PORT"] ?? "3200");
  await app.listen({ port, host: "0.0.0.0" });

  logger.info("collector started", {
    port,
    writeKeys: writeKeys.size,
    allowedOrigins: allowedOrigins.length,
    trustedProxyCount,
  });

  const shutdown = async (): Promise<void> => {
    logger.info("collector stopping");
    await app.close();
    await publisher.disconnect();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`collector failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
