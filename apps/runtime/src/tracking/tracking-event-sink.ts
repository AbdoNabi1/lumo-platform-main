import { PrismaOutboxEventPublisher } from "@platform/db";
import { KafkaMessageProducer } from "@platform/kafka";
import type { EventPublisher } from "@platform/messaging";
import type { RuntimeCore } from "../composition";

/**
 * Where `POST /public/tracking/collect` puts an accepted event (Tracking P1-D1) — the producer half
 * of the one capture path, chosen by the same switch as every other event:
 *
 * - `EVENT_TRANSPORT=postgres`: an append to `platform.outbox` (topic `tracking.event.captured.v1`,
 *   key = tenant). The outbox relay hands it to the SAME `TrackingIngestHandler` the Kafka path uses.
 * - `EVENT_TRANSPORT=kafka` (default): a direct publish to the broker, exactly what the standalone
 *   collector does. The producer connects on first use, so building it opens no connection.
 */
export function buildTrackingEventSink(
  core: Pick<RuntimeCore, "config" | "prisma" | "kafka" | "clock">,
): EventPublisher {
  return core.config.EVENT_TRANSPORT === "postgres"
    ? new PrismaOutboxEventPublisher(core.prisma, () => core.clock.now())
    : new KafkaMessageProducer(core.kafka);
}
