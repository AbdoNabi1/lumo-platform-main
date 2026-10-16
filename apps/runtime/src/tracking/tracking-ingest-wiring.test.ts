import { describe, expect, it, vi } from "vitest";
import {
  TRACKING_CAPTURED_TOPIC,
  TRACKING_CAPTURED_VERSION,
  type IngestRuntimeDeps,
} from "@platform/tracking";
import { TrackingIngestHandler } from "./tracking-ingest";

/**
 * Guards the defect investigation C-07 found: `ingestTrackingEvent` had **zero callers**. The
 * collector published `tracking.event.captured.v1` and nothing subscribed, so every beacon was
 * accepted, written to Kafka, and aged out unprocessed — silently, because "no events delivered"
 * and "no traffic" look identical in every dashboard.
 *
 * These assertions are deliberately structural rather than behavioural: they prove the consumer
 * exists and is addressed at the topic the producer actually writes to. The pipeline's own
 * behaviour is covered by `@platform/tracking`'s 234 tests; duplicating it here would test the
 * package, not the wiring.
 */

function handlerWith(
  ingest: (tenantId: string) => Promise<IngestRuntimeDeps>,
): TrackingIngestHandler {
  return new TrackingIngestHandler({
    ingest,
    deadLetters: { add: async () => undefined },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    clock: { now: () => new Date("2026-08-04T00:00:00.000Z") },
  });
}

describe("tracking ingest wiring (C-07)", () => {
  it("subscribes to exactly the topic the collector publishes", () => {
    const handler = handlerWith(async () => ({}) as IngestRuntimeDeps);

    // The collector serializes with these same two constants (apps/collector/src/
    // collector-endpoint.ts). Reading them from the package on both sides is what stops the
    // producer and consumer drifting into two string literals that no longer match.
    expect(handler.eventType).toBe(TRACKING_CAPTURED_TOPIC);
    expect(handler.eventVersion).toBe(TRACKING_CAPTURED_VERSION);
    expect(`${handler.eventType}.v${String(handler.eventVersion)}`).toBe(
      "tracking.event.captured.v1",
    );
  });

  it("starts with every counter at zero, so 'wired but dead' is observable", () => {
    // A counter that never moves is the signal C-07 describes: the pipeline present, reachable in
    // principle, and never actually invoked.
    expect(handlerWith(async () => ({}) as IngestRuntimeDeps).counters()).toEqual({
      received: 0,
      accepted: 0,
      refused: 0,
      deadLettered: 0,
      deliveredTargets: 0,
    });
  });

  it("resolves ingest dependencies once per event, so a registry hot-reload cannot land mid-event", async () => {
    // The provider indirection is load-bearing: `TrackingRegistryHandle.current()` must be read
    // exactly once per event and threaded through routing, mapping, delivery and version stamping.
    // Re-reading it mid-pipeline would let a swap stamp a record with a version that never produced
    // its bytes.
    const ingest = vi.fn(async (_tenantId: string) => ({}) as IngestRuntimeDeps);
    const handler = handlerWith(ingest);

    await handler
      .handle({
        tenantId: "tenant-a",
        payload: { envelope: { tenancy: { tenantId: "tenant-a" } } },
      } as never)
      .catch(() => undefined); // the empty deps make the pipeline refuse; the call count is the point

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(handler.counters().received).toBe(1);
  });
});
