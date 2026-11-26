import { describe, expect, it, vi } from "vitest";
import { HttpJsonAdapter } from "@platform/tracking";
import { TrackingRegistrySnapshot } from "./tracking-registry";
import { TrackingRegistryHandle } from "./tracking-registry-handle";
import { wireTrackingRuntime, type TrackingRuntimeInput } from "./wire-tracking-runtime";

const snapshotWith = (pixel: string) =>
  new TrackingRegistrySnapshot([
    {
      kind: "destination",
      key: "meta",
      version: 1,
      status: "active",
      value: { key: "meta", pixel },
    },
    { kind: "rule_set", key: "tracking.routing.default", version: 1, status: "active", value: {} },
  ]);

function input(overrides: Partial<Record<keyof TrackingRuntimeInput, unknown>> = {}) {
  const handle = new TrackingRegistryHandle(snapshotWith("v1"), { count: 2, latestAt: 1 });
  return {
    handle,
    input: {
      db: {} as never,
      idGenerator: { generate: () => "id" },
      secrets: { get: () => undefined, require: () => "" },
      registry: handle,
      ruleSetKey: "tracking.routing.default",
      clock: { now: () => new Date("2026-10-18T00:00:00.000Z") },
      processed: { recordIfNew: vi.fn(async () => true) },
      deadLetters: { add: vi.fn(async () => undefined) },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
      ...overrides,
    } as TrackingRuntimeInput,
  };
}

describe("wireTrackingRuntime", () => {
  it("refuses to boot and names every missing dependency at once", () => {
    const { input: partial } = input({ db: undefined, secrets: null, ruleSetKey: "" });
    expect(() => wireTrackingRuntime(partial)).toThrow(
      /^tracking runtime is not fully wired — missing: db, secrets, ruleSetKey\. /,
    );
  });

  it("binds one ingest unit to the snapshot that was current when it started", () => {
    const { input: wired, handle } = input();
    const runtime = wireTrackingRuntime(wired);

    const before = runtime.ingest();
    handle.swap(snapshotWith("v2"), { count: 3, latestAt: 2 });
    const after = runtime.ingest();

    // The in-flight event keeps resolving against the snapshot it pinned.
    expect(before.destinations.resolve("meta" as never)).toEqual({ key: "meta", pixel: "v1" });
    expect(before.recording.versions).toBe(before.destinations);
    expect(after.destinations.resolve("meta" as never)).toEqual({ key: "meta", pixel: "v2" });
    expect(after.recording.versions).toBe(after.destinations);
  });

  it("threads the configured rule-set key and the snapshot's rule sets into each unit", () => {
    const { input: wired } = input();
    const deps = wireTrackingRuntime(wired).ingest();
    expect(deps.ruleSetKey).toBe("tracking.routing.default");
    expect(deps.ruleSets.resolve("tracking.routing.default")).toEqual({});
    expect(deps.recording.delivery.mappings.resolve("missing")).toBeNull();
  });

  it("shares process-lifetime state (breakers, hasher, store) across ingest units", () => {
    const { input: wired } = input();
    const runtime = wireTrackingRuntime(wired);
    const a = runtime.ingest();
    const b = runtime.ingest();

    expect(a.recording.destinationState).toBe(b.recording.destinationState);
    expect(a.hasher).toBe(b.hasher);
    expect(a.recording.records).toBe(runtime.store);
    expect(runtime.registry).toBe(wired.registry);
  });

  it("serves every destination through the one HTTP JSON adapter, and nothing else", () => {
    const { input: wired } = input();
    const { adapters } = wireTrackingRuntime(wired).ingest().recording.delivery;
    expect(adapters.resolve("http_json")).toBeInstanceOf(HttpJsonAdapter);
    expect(adapters.resolve("sftp" as never)).toBeNull();
  });

  it("wires the caller's idempotency and dead-letter stores and clock into delivery", () => {
    const { input: wired } = input();
    const { delivery } = wireTrackingRuntime(wired).ingest().recording;
    expect(delivery.processed).toBe(wired.processed);
    expect(delivery.deadLetters).toBe(wired.deadLetters);
    expect(delivery.now?.()).toEqual(new Date("2026-10-18T00:00:00.000Z"));
  });

  it("resolves credentials through the configured secret provider", async () => {
    const { input: wired } = input({
      secrets: { get: (key: string) => (key === "META" ? "tok" : undefined), require: () => "" },
    });
    expect(await wireTrackingRuntime(wired).credentials.resolve("vault://META")).toBe("tok");
  });
});
