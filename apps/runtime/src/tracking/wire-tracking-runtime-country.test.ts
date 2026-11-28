import type { SecretProvider } from "@platform/secrets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeTrackingDb } from "./testing/fake-tracking-db";
import { PrismaTrackingRegistryStore, loadTrackingRegistry } from "./tracking-registry";
import { TrackingRegistryHandle } from "./tracking-registry-handle";
import { wireTrackingRuntime } from "./wire-tracking-runtime";

beforeEach(() => {
  expect.hasAssertions();
});

async function wire(defaultCountryCode: string | undefined) {
  const db = fakeTrackingDb();
  const registryStore = new PrismaTrackingRegistryStore(db.prisma as never, {
    generate: () => "id-1",
  });
  const handle = new TrackingRegistryHandle(
    await loadTrackingRegistry(registryStore, "t-1"),
    await registryStore.signal("t-1"),
  );
  return wireTrackingRuntime({
    db: db.prisma as never,
    idGenerator: { generate: () => "id-1" },
    secrets: { get: () => Promise.resolve(null) } as unknown as SecretProvider,
    registry: handle,
    ruleSetKey: "default",
    clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
    processed: { recordIfNew: () => Promise.resolve(true) },
    deadLetters: { add: () => Promise.resolve() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...(defaultCountryCode === undefined ? {} : { defaultCountryCode }),
  });
}

describe("wireTrackingRuntime defaultCountryCode (P2-D7)", () => {
  it("hands the tenant's calling code to the recording pipeline of every ingest", async () => {
    const runtime = await wire("966");
    expect(runtime.ingest().recording.defaultCountryCode).toBe("966");
  });

  it("leaves it absent when the caller gave none (such phones are dropped, as before)", async () => {
    const runtime = await wire(undefined);
    expect(runtime.ingest().recording.defaultCountryCode).toBeUndefined();
  });
});
