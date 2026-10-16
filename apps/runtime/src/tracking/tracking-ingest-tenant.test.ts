import type { IntegrationEvent } from "@platform/domain-events";
import type { IngestRuntimeDeps } from "@platform/tracking";
import { describe, expect, it, vi } from "vitest";
import { TenantRuntimes } from "./tenant-runtimes";
import { TrackingIngestHandler, type TrackingCapturedPayload } from "./tracking-ingest";

/**
 * G-64 — tracking ingest routes by the ENVELOPE's tenant. Until now one registry (and one watcher)
 * was loaded for `TENANT_DEFAULT_ID` and every tenant's `tracking.event.captured.v1` was ingested
 * against it: tenant B's beacon would have been routed through tenant A's destinations.
 *
 * Direction with no tenant: ingest only ADDS delivery records and forwards, so nothing is protected
 * by skipping — but a beacon dropped quietly is lost revenue signal, so it is refused into the dead
 * letters (the same visible sink the handler already uses for a permanently bad event) and acked.
 * A message whose two tenants disagree (envelope vs the payload's own `tenancy`) is refused the same
 * way: ingesting it would file it under one tenant and route it through the other's registry.
 */

function event(
  tenantId: string | undefined,
  payloadTenant: string | undefined = tenantId,
): IntegrationEvent<TrackingCapturedPayload> {
  return {
    messageId: `m-${tenantId ?? "none"}`,
    type: "tracking.event.captured",
    eventVersion: 1,
    aggregateId: "e1",
    aggregateType: "tracking_event",
    occurredAt: "2026-09-26T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    metadata: {},
    ...(tenantId === undefined ? {} : { tenantId }),
    payload: {
      envelope: payloadTenant === undefined ? {} : { tenancy: { tenantId: payloadTenant } },
    },
  } as unknown as IntegrationEvent<TrackingCapturedPayload>;
}

function handler() {
  const ingest = vi.fn(async (_tenantId: string) => ({}) as IngestRuntimeDeps);
  const deadLetters = { add: vi.fn(async () => undefined) };
  const h = new TrackingIngestHandler({
    ingest,
    deadLetters,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    clock: { now: () => new Date("2026-09-26T00:00:00.000Z") },
  });
  return { h, ingest, deadLetters };
}

describe("TrackingIngestHandler — envelope tenant (G-64)", () => {
  it("resolves ingest dependencies for each event's own tenant, once per event", async () => {
    const { h, ingest } = handler();
    await h.handle(event("tenant-a")).catch(() => undefined); // empty deps make the pipeline refuse
    await h.handle(event("tenant-b")).catch(() => undefined);
    expect(ingest.mock.calls.map((c) => c[0])).toEqual(["tenant-a", "tenant-b"]);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
  ])(
    "refuses an %s envelope tenant into the dead letters without resolving any registry",
    async (_n, tenant) => {
      const { h, ingest, deadLetters } = handler();
      await expect(h.handle(event(tenant, "tenant-a"))).resolves.toBeUndefined();
      expect(ingest).not.toHaveBeenCalled();
      expect(deadLetters.add).toHaveBeenCalledTimes(1);
      expect(h.counters().deadLettered).toBe(1);
    },
  );

  it("refuses a message whose envelope tenant and payload tenancy disagree", async () => {
    const { h, ingest, deadLetters } = handler();
    await expect(h.handle(event("tenant-a", "tenant-b"))).resolves.toBeUndefined();
    expect(ingest).not.toHaveBeenCalled();
    expect(deadLetters.add).toHaveBeenCalledTimes(1);
  });
});

describe("TenantRuntimes — one lazily-built runtime per tenant", () => {
  it("builds each tenant's runtime once, and never shares one across tenants", async () => {
    const load = vi.fn(async (tenantId: string) => ({ runtime: { tenantId }, stop: vi.fn() }));
    const runtimes = new TenantRuntimes(load);

    const a1 = await runtimes.for("tenant-a");
    const a2 = await runtimes.for("tenant-a");
    const b = await runtimes.for("tenant-b");

    expect(a1).toBe(a2);
    expect(b).toEqual({ tenantId: "tenant-b" });
    expect(load.mock.calls.map((c) => c[0])).toEqual(["tenant-a", "tenant-b"]);
  });

  it("concurrent first events for one tenant share a single load", async () => {
    const load = vi.fn(async (tenantId: string) => ({ runtime: { tenantId }, stop: vi.fn() }));
    const runtimes = new TenantRuntimes(load);
    await Promise.all([runtimes.for("tenant-a"), runtimes.for("tenant-a")]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a failed load throws and is NOT cached, so the retry re-attempts it", async () => {
    let calls = 0;
    const load = vi.fn(async (tenantId: string) => {
      calls += 1;
      if (calls === 1) throw new Error(`no registry for ${tenantId}`);
      return { runtime: { tenantId }, stop: vi.fn() };
    });
    const runtimes = new TenantRuntimes(load);
    await expect(runtimes.for("tenant-a")).rejects.toThrow(/no registry/);
    await expect(runtimes.for("tenant-a")).resolves.toEqual({ tenantId: "tenant-a" });
  });

  it("stopAll stops every built tenant's watcher", async () => {
    const stops: Record<string, ReturnType<typeof vi.fn>> = {};
    const runtimes = new TenantRuntimes(async (tenantId: string) => {
      stops[tenantId] = vi.fn();
      return { runtime: tenantId, stop: stops[tenantId] as () => void };
    });
    await runtimes.for("tenant-a");
    await runtimes.for("tenant-b");
    await runtimes.stopAll();
    expect(stops["tenant-a"]).toHaveBeenCalledTimes(1);
    expect(stops["tenant-b"]).toHaveBeenCalledTimes(1);
  });

  it("refuses to build for a missing tenant rather than defaulting one", async () => {
    const load = vi.fn();
    const runtimes = new TenantRuntimes(load);
    await expect(runtimes.for("")).rejects.toThrow(/tenant/i);
    expect(load).not.toHaveBeenCalled();
  });
});
