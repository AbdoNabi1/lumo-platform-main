import type { Database } from "@platform/db";
import type { RateLimiter } from "@platform/contracts";
import type { TrackingEnvelope } from "@platform/tracking";
import { beforeEach, describe, expect, it } from "vitest";

import {
  BURST_WINDOW_MS,
  FINGERPRINT_BURST_LIMIT,
  VISITOR_BURST_LIMIT,
  createBurstPort,
  loadGeoLookup,
  wireTrackingCollect,
  type GeoLoadIo,
} from "./tracking-collect-enrichment";

beforeEach(() => {
  expect.hasAssertions();
});

/** The smallest valid MaxMind DB: one node whose both records point at one data record `{country:{iso_code:"EG"}}`. */
function tinyMmdb(): Uint8Array {
  const text = (value: string): number[] => [(2 << 5) | value.length, ...Buffer.from(value)];
  const map = (...entries: number[][]): number[] => [
    (7 << 5) | (entries.length / 2),
    ...entries.flat(),
  ];
  const data = map(text("country"), map(text("iso_code"), text("EG")));
  const metadata = map(
    text("node_count"),
    [(6 << 5) | 1, 1],
    text("record_size"),
    [(5 << 5) | 1, 24],
    text("ip_version"),
    [(5 << 5) | 1, 4],
    text("database_type"),
    text("Test-Country"),
  );
  const marker = [
    0xab, 0xcd, 0xef, 0x4d, 0x61, 0x78, 0x4d, 0x69, 0x6e, 0x64, 0x2e, 0x63, 0x6f, 0x6d,
  ];
  // node_count 1 ⇒ a data pointer is 1 + 16 + offset 0 = 17 = 0x000011, for the left and the right record
  return Uint8Array.from([
    0,
    0,
    17,
    0,
    0,
    17,
    ...new Array<number>(16).fill(0),
    ...data,
    ...marker,
    ...metadata,
  ]);
}

function io(bytes: Uint8Array | Error): {
  io: GeoLoadIo;
  warnings: Record<string, unknown>[];
  read: string[];
} {
  const warnings: Record<string, unknown>[] = [];
  const read: string[] = [];
  return {
    warnings,
    read,
    io: {
      readFile: (path) => {
        read.push(path);
        if (bytes instanceof Error) throw bytes;
        return bytes;
      },
      warn: (_message, fields) => warnings.push(fields),
    },
  };
}

describe("loadGeoLookup", () => {
  it("unset means geo is off: never reads a file, never warns", () => {
    const probe = io(tinyMmdb());
    for (const path of [undefined, "", "   "]) {
      expect(loadGeoLookup(path, probe.io).lookup("41.32.7.9")).toBeNull();
    }
    expect(probe.read).toEqual([]);
    expect(probe.warnings).toEqual([]);
  });

  it("reads the configured file once and answers from it", () => {
    const probe = io(tinyMmdb());
    const geo = loadGeoLookup("/data/geo.mmdb", probe.io);
    expect(geo.lookup("41.32.7.9")).toEqual({ country: "EG" });
    expect(geo.lookup("8.8.8.8")).toEqual({ country: "EG" });
    expect(probe.read).toEqual(["/data/geo.mmdb"]);
    expect(probe.warnings).toEqual([]);
  });

  it("a missing file degrades to unknown with one warning that carries the error name only", () => {
    const missing = Object.assign(new Error("ENOENT: no such file '/data/geo.mmdb'"), {
      name: "Error",
    });
    const probe = io(missing);
    expect(loadGeoLookup("/data/geo.mmdb", probe.io).lookup("41.32.7.9")).toBeNull();
    expect(probe.warnings).toEqual([{ error: "Error" }]);
    expect(JSON.stringify(probe.warnings)).not.toContain("/data");
  });

  it("a corrupt file degrades to unknown with one warning", () => {
    const probe = io(Uint8Array.from([1, 2, 3, 4]));
    expect(loadGeoLookup("/data/geo.mmdb", probe.io).lookup("41.32.7.9")).toBeNull();
    expect(probe.warnings).toEqual([{ error: "MmdbFormatError" }]);
  });
});

describe("createBurstPort", () => {
  function limiter(deny: (key: string) => boolean): { port: RateLimiter; calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      port: {
        consume: (key, limit, windowMs) => {
          calls.push([key, limit, windowMs]);
          return Promise.resolve({ allowed: !deny(key), remaining: 0, retryAfterMs: 0 });
        },
      },
    };
  }

  it("counts per store and per visitor id / fingerprint — never per IP", async () => {
    const { port, calls } = limiter(() => false);
    const verdict = await createBurstPort(port).check({
      tenantId: "t-1",
      visitorId: "v-1",
      fingerprintId: "f".repeat(32),
    });
    expect(verdict).toEqual({ visitorBurst: false, fingerprintBurst: false });
    expect(calls).toEqual([
      ["tracking-burst:visitor:t-1:v-1", VISITOR_BURST_LIMIT, BURST_WINDOW_MS],
      [
        `tracking-burst:fingerprint:t-1:${"f".repeat(32)}`,
        FINGERPRINT_BURST_LIMIT,
        BURST_WINDOW_MS,
      ],
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/\d+\.\d+\.\d+\.\d+/u);
  });

  it("flags each independently and asks only about what the event has", async () => {
    const visitorOnly = limiter((key) => key.includes(":visitor:"));
    expect(
      await createBurstPort(visitorOnly.port).check({ tenantId: "t-1", visitorId: "v-1" }),
    ).toEqual({
      visitorBurst: true,
      fingerprintBurst: false,
    });
    expect(visitorOnly.calls).toHaveLength(1);

    const fingerprintOnly = limiter((key) => key.includes(":fingerprint:"));
    expect(
      await createBurstPort(fingerprintOnly.port).check({
        tenantId: "t-1",
        visitorId: "v-1",
        fingerprintId: "f".repeat(32),
      }),
    ).toEqual({ visitorBurst: false, fingerprintBurst: true });
  });

  it("another store's visitor id has its own bucket", async () => {
    const { port, calls } = limiter(() => false);
    await createBurstPort(port).check({ tenantId: "t-1", visitorId: "v-1" });
    await createBurstPort(port).check({ tenantId: "t-2", visitorId: "v-1" });
    expect(new Set(calls.map((call) => call[0])).size).toBe(2);
  });
});

describe("wireTrackingCollect", () => {
  const prisma = {} as unknown as Database;
  const deps = {
    geoDbPath: undefined,
    rateLimiter: {
      consume: () => Promise.resolve({ allowed: true, remaining: 1, retryAfterMs: 0 }),
    },
    prisma,
    idGenerator: { generate: () => "id-1" },
    clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
  };
  const event: TrackingEnvelope = {
    eventId: "e-1",
    eventName: "page_viewed",
    eventVersion: 1,
    timestamp: "2026-11-28T10:00:00.000Z",
    source: "web",
    consent: { analytics: true, marketing: true, personalization: false },
    context: { session: { visitorId: "v-1" } },
    properties: {},
  };

  it("has no enricher without the edge secret (the collect route is off then); the list service always exists", () => {
    const wired = wireTrackingCollect({ ...deps, secret: undefined });
    expect(wired.enricher).toBeUndefined();
    expect(wired.blockedIps).toBeDefined();
  });

  it("with the secret it stamps bot score and the per-store cookieless id", async () => {
    const wired = wireTrackingCollect({ ...deps, secret: "s".repeat(40) });
    const signals = {
      ip: "41.32.7.9",
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-G991B) Chrome/124.0.6367.82 Mobile Safari/537.36",
      acceptLanguage: "ar-EG",
      secChUa: '"Chromium";v="124"',
      host: "shop.example",
    };
    const a = await wired.enricher?.({ tenantId: "t-1", envelope: event, signals });
    const b = await wired.enricher?.({ tenantId: "t-2", envelope: event, signals });
    expect(a?.context.technical).toMatchObject({ botScore: 0, deviceType: "mobile" });
    expect(a?.context.technical?.fingerprintId).toMatch(/^[0-9a-f]{32}$/u);
    expect(b?.context.technical?.fingerprintId).not.toBe(a?.context.technical?.fingerprintId);
  });
});
