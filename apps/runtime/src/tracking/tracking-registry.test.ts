import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadTrackingRegistry,
  mappingRegistryOf,
  PrismaTrackingRegistryStore,
  RegistryVersionParityError,
  ruleSetRegistryOf,
  TrackingRegistrySnapshot,
  type TrackingRegistryRow,
} from "./tracking-registry";
import {
  signalsDiffer,
  TrackingRegistryHandle,
  TrackingRegistryWatcher,
  type RegistrySignal,
} from "./tracking-registry-handle";

const row = (
  kind: string,
  key: string,
  version: number,
  value: unknown,
  status = "active",
): TrackingRegistryRow => ({ kind, key, version, status, value });

/** A meta destination with two versions, a retired pinterest, a mapping and a rule set. */
const rows: readonly TrackingRegistryRow[] = [
  row("destination", "meta", 1, { key: "meta", pixel: "v1" }),
  row("destination", "meta", 2, { key: "meta", pixel: "v2" }),
  row("destination", "pinterest", 1, { key: "pinterest" }, "retired"),
  row("mapping", "meta-default", 1, { key: "meta-default", fields: 1 }),
  row("mapping", "meta-default", 2, { key: "meta-default", fields: 2 }, "deprecated"),
  row("rule_set", "default", 1, { id: "default", rules: [] }),
  // A P5.5 kind is not projected into the snapshot and does not break the load.
  row("event_definition", "purchase", 1, { name: "purchase" }),
];

function fakeDb(stored: readonly TrackingRegistryRow[] = rows) {
  const entries = {
    create: vi.fn(async () => undefined),
    findMany: vi.fn(async () => [...stored]),
    findFirst: vi.fn(async (): Promise<{ registeredAt: Date } | null> => null),
    count: vi.fn(async () => stored.length),
  };
  return { db: { trackingRegistryEntry: entries } as never, entries };
}

const ids = { generate: () => "id-1" };

describe("TrackingRegistrySnapshot", () => {
  const snapshot = new TrackingRegistrySnapshot(rows);

  it("resolves the current version of an active destination", () => {
    expect(snapshot.resolve("meta" as never)).toEqual({ key: "meta", pixel: "v2" });
    expect(snapshot.destinationVersion("meta" as never)).toBe(2);
  });

  it("keeps every historical version resolvable for replay", () => {
    expect(snapshot.resolveVersion("meta" as never, 1)).toEqual({ key: "meta", pixel: "v1" });
    expect(snapshot.resolveVersion("meta" as never, 3)).toBeNull();
    expect(snapshot.resolveVersion("tiktok" as never, 1)).toBeNull();
  });

  it("does not serve a retired destination today, but still answers for its history", () => {
    expect(snapshot.resolve("pinterest" as never)).toBeNull();
    expect(snapshot.resolveVersion("pinterest" as never, 1)).toEqual({ key: "pinterest" });
    expect(snapshot.listActive()).toEqual([{ key: "meta", pixel: "v2" }]);
  });

  it("returns null for an unknown destination rather than a default", () => {
    expect(snapshot.resolve("tiktok" as never)).toBeNull();
  });

  it("treats a deprecated mapping as unresolvable but keeps its versions", () => {
    expect(snapshot.resolveMapping("meta-default")).toBeNull();
    expect(snapshot.resolveMappingVersion("meta-default", 1)).toEqual({
      key: "meta-default",
      fields: 1,
    });
    expect(snapshot.mappingVersion("meta-default")).toBe(2);
  });

  it("serves the active rule set and its version", () => {
    expect(snapshot.resolveRuleSet("default")).toEqual({ id: "default", rules: [] });
    expect(snapshot.resolveRuleSetVersion("default", 1)).toEqual({ id: "default", rules: [] });
    expect(snapshot.resolveRuleSet("missing")).toBeNull();
    expect(snapshot.ruleSetFor("default")).toEqual({ id: "default", version: 1 });
    expect(snapshot.ruleSetFor("missing")).toBeNull();
    expect(snapshot.ruleSet()).toEqual({ id: "default", version: 1 });
  });

  it("reports no rule set when none is active", () => {
    const empty = new TrackingRegistrySnapshot([row("destination", "meta", 1, {})]);
    expect(empty.ruleSet()).toBeNull();
    expect(empty.resolveRuleSetVersion("default", 1)).toBeNull();
    expect(empty.resolveMappingVersion("meta-default", 1)).toBeNull();
  });

  it("throws instead of pinning version 0 for an unregistered destination or mapping", () => {
    expect(() => snapshot.destinationVersion("tiktok" as never)).toThrow(
      'tracking: destination "tiktok" is not registered',
    );
    expect(() => snapshot.mappingVersion("nope")).toThrow(
      'tracking: mapping profile "nope" is not registered',
    );
  });

  it("refuses to build when the stored versions have a gap", () => {
    const gapped = [row("destination", "meta", 1, {}), row("destination", "meta", 3, {})];
    expect(() => new TrackingRegistrySnapshot(gapped)).toThrow(RegistryVersionParityError);
    try {
      new TrackingRegistrySnapshot(gapped);
    } catch (error) {
      expect((error as Error).name).toBe("RegistryVersionParityError");
      expect((error as Error).message).toBe(
        'tracking registry: destination "meta" is stored as version 3 but replays as 2 — the ' +
          "version history has a gap and cannot be loaded without renumbering",
      );
    }
  });

  it("refuses to build when a row cannot be registered at all", () => {
    expect(() => new TrackingRegistrySnapshot([row("mapping", "  ", 1, {})])).toThrow(
      /^tracking registry: mapping " {2}": /,
    );
  });
});

describe("mappingRegistryOf / ruleSetRegistryOf", () => {
  const snapshot = new TrackingRegistrySnapshot([
    row("mapping", "m", 1, { key: "m" }),
    row("rule_set", "r", 1, { id: "r" }),
  ]);

  it("expose the snapshot's mappings under the MappingRegistryPort names", () => {
    const port = mappingRegistryOf(snapshot);
    expect(port.resolve("m")).toEqual({ key: "m" });
    expect(port.resolveVersion("m", 1)).toEqual({ key: "m" });
    expect(port.resolve("r")).toBeNull();
  });

  it("expose the snapshot's rule sets under the RuleSetRegistryPort names", () => {
    const port = ruleSetRegistryOf(snapshot);
    expect(port.resolve("r")).toEqual({ id: "r" });
    expect(port.resolveVersion("r", 1)).toEqual({ id: "r" });
    expect(port.resolve("m")).toBeNull();
  });
});

describe("PrismaTrackingRegistryStore", () => {
  it("loads one tenant's rows in replay order", async () => {
    const { db, entries } = fakeDb();
    await new PrismaTrackingRegistryStore(db, ids).loadAll("tenant-a");
    expect(entries.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a" },
      orderBy: [{ kind: "asc" }, { key: "asc" }, { version: "asc" }],
    });
  });

  it("counts only the tenant's rows", async () => {
    const { db, entries } = fakeDb();
    expect(await new PrismaTrackingRegistryStore(db, ids).count("tenant-a")).toBe(rows.length);
    expect(entries.count).toHaveBeenCalledWith({ where: { tenantId: "tenant-a" } });
  });

  it("fingerprints the row set as count plus newest registered_at", async () => {
    const { db, entries } = fakeDb();
    entries.findFirst.mockResolvedValueOnce({ registeredAt: new Date(5_000) });
    const store = new PrismaTrackingRegistryStore(db, ids);
    expect(await store.signal("tenant-a")).toEqual({ count: rows.length, latestAt: 5_000 });
    expect(entries.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a" },
      orderBy: { registeredAt: "desc" },
      select: { registeredAt: true },
    });
  });

  it("reports latestAt 0 for an empty registry", async () => {
    const { db } = fakeDb([]);
    expect(await new PrismaTrackingRegistryStore(db, ids).signal("tenant-a")).toEqual({
      count: 0,
      latestAt: 0,
    });
  });

  it("appends a new immutable row, never an update", async () => {
    const { db, entries } = fakeDb();
    const at = new Date("2026-10-18T00:00:00.000Z");
    await new PrismaTrackingRegistryStore(db, ids).append({
      tenantId: "tenant-a",
      kind: "destination",
      key: "meta",
      version: 3,
      status: "active",
      value: { pixel: "v3" },
      at,
    });
    expect(entries.create).toHaveBeenCalledWith({
      data: {
        id: "id-1",
        tenantId: "tenant-a",
        kind: "destination",
        key: "meta",
        version: 3,
        status: "active",
        value: { pixel: "v3" },
        registeredAt: at,
      },
    });
  });
});

describe("loadTrackingRegistry", () => {
  it("builds a snapshot from the tenant's rows", async () => {
    const { db } = fakeDb();
    const snapshot = await loadTrackingRegistry(new PrismaTrackingRegistryStore(db, ids), "t");
    expect(snapshot.destinationVersion("meta" as never)).toBe(2);
  });

  it("refuses to start on an empty registry instead of forwarding nowhere", async () => {
    const { db } = fakeDb([]);
    await expect(
      loadTrackingRegistry(new PrismaTrackingRegistryStore(db, ids), "tenant-a"),
    ).rejects.toThrow(/no registry definitions for tenant "tenant-a"/);
  });
});

describe("signalsDiffer", () => {
  it("is false only when both count and latestAt match", () => {
    const a: RegistrySignal = { count: 2, latestAt: 10 };
    expect(signalsDiffer(a, { count: 2, latestAt: 10 })).toBe(false);
    expect(signalsDiffer(a, { count: 3, latestAt: 10 })).toBe(true);
    expect(signalsDiffer(a, { count: 2, latestAt: 11 })).toBe(true);
  });
});

describe("TrackingRegistryHandle", () => {
  it("serves one snapshot until a swap, then the next, bumping the generation", () => {
    const first = new TrackingRegistrySnapshot(rows);
    const second = new TrackingRegistrySnapshot([row("destination", "tiktok", 1, {})]);
    const handle = new TrackingRegistryHandle(first, { count: 1, latestAt: 1 });

    expect(handle.current()).toBe(first);
    expect(handle.generation()).toBe(1);
    expect(handle.currentSignal()).toEqual({ count: 1, latestAt: 1 });

    expect(handle.swap(second, { count: 2, latestAt: 2 })).toBe(2);
    expect(handle.current()).toBe(second);
    expect(handle.generation()).toBe(2);
    expect(handle.currentSignal()).toEqual({ count: 2, latestAt: 2 });
  });
});

describe("TrackingRegistryWatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

  function setup(
    signal: () => Promise<RegistrySignal>,
    loadAll: () => Promise<readonly TrackingRegistryRow[]> = async () => rows,
  ) {
    const initial = new TrackingRegistrySnapshot([row("destination", "old", 1, {})]);
    const handle = new TrackingRegistryHandle(initial, { count: 1, latestAt: 100 });
    const store = { signal: vi.fn(signal), loadAll: vi.fn(loadAll) } as never;
    const log = logger();
    const watcher = new TrackingRegistryWatcher({
      handle,
      store,
      tenantId: "tenant-a",
      logger: log as never,
      intervalMs: 1_000,
    });
    return { watcher, handle, initial, store: store as { loadAll: ReturnType<typeof vi.fn> }, log };
  }

  it("does not reload when the fingerprint has not moved", async () => {
    const { watcher, handle, initial, store } = setup(async () => ({ count: 1, latestAt: 100 }));
    expect(await watcher.refreshNow()).toEqual({
      status: "unchanged",
      signal: { count: 1, latestAt: 100 },
    });
    expect(store.loadAll).not.toHaveBeenCalled();
    expect(handle.current()).toBe(initial);
  });

  it("swaps in a fully built snapshot when the fingerprint moves, and logs it", async () => {
    const { watcher, handle, initial, log } = setup(async () => ({ count: 7, latestAt: 200 }));
    expect(await watcher.refreshNow()).toEqual({
      status: "swapped",
      signal: { count: 7, latestAt: 200 },
      generation: 2,
      activeDestinations: 1,
    });
    expect(handle.current()).not.toBe(initial);
    expect(handle.current().resolve("meta" as never)).toEqual({ key: "meta", pixel: "v2" });
    expect(log.info).toHaveBeenCalledWith("tracking registry reloaded", {
      tenantId: "tenant-a",
      generation: 2,
      definitions: 7,
      activeDestinations: 1,
    });
  });

  it("keeps the previous snapshot live when the new rows fail the parity guard", async () => {
    const { watcher, handle, initial } = setup(
      async () => ({ count: 2, latestAt: 200 }),
      async () => [row("destination", "meta", 2, {})],
    );
    const outcome = await watcher.refreshNow();
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.error).toBeInstanceOf(RegistryVersionParityError);
    expect(handle.current()).toBe(initial);
    expect(handle.generation()).toBe(1);
  });

  it("wraps a non-Error rejection so the outcome always carries an Error", async () => {
    const { watcher } = setup(() => Promise.reject("db down"));
    const outcome = await watcher.refreshNow();
    expect(outcome).toEqual({ status: "failed", error: new Error("db down") });
  });

  it("polls on its interval, logs failed refreshes, and stops cleanly", async () => {
    vi.useFakeTimers();
    const { watcher, log } = setup(() => Promise.reject(new Error("db down")));
    watcher.start();
    watcher.start(); // idempotent: one timer only

    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("tracking registry refresh failed", {
      tenantId: "tenant-a",
      error: "db down",
    });

    watcher.stop();
    watcher.stop(); // idempotent
    await vi.advanceTimersByTimeAsync(5_000);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("skips a tick while a slow refresh is still running instead of stacking loads", async () => {
    vi.useFakeTimers();
    let release: (value: RegistrySignal) => void = () => undefined;
    const pending = new Promise<RegistrySignal>((resolve) => {
      release = resolve;
    });
    const signal = vi.fn(() => pending);
    const handle = new TrackingRegistryHandle(new TrackingRegistrySnapshot(rows), {
      count: 1,
      latestAt: 1,
    });
    const watcher = new TrackingRegistryWatcher({
      handle,
      store: { signal, loadAll: vi.fn(async () => rows) } as never,
      tenantId: "tenant-a",
      logger: logger() as never,
      intervalMs: 1_000,
    });

    watcher.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(signal).toHaveBeenCalledTimes(1);

    release({ count: 1, latestAt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal).toHaveBeenCalledTimes(2);
    watcher.stop();
  });
});
