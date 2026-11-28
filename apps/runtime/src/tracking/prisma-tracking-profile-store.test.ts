import type { Database } from "@platform/db";
import { createProfile, type TrackingProfile } from "@platform/tracking";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaTrackingProfileStore, toProfile } from "./prisma-tracking-profile-store";

/**
 * Statement-level tests: no database is reachable from here, so what is pinned is what the adapter ASKS the
 * database — the tenant is set first and named in every `where`, writes are conditional on the version read, a
 * lost race rolls the whole change back, and a tombstone holds nothing. The behaviour itself (conflicts, erase,
 * expiry) is proven against the in-memory twin and, on a real database, by the gated integration test.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const T0 = "2026-11-01T10:00:00.000Z";

interface Call {
  readonly op: string;
  readonly args: unknown;
}

function fakeDb(
  handlers: {
    findFirst?: (args: Record<string, unknown>) => unknown;
    findMany?: (args: Record<string, unknown>) => unknown;
    createMany?: (args: Record<string, unknown>) => { count: number };
    updateMany?: (args: Record<string, unknown>) => { count: number };
    deleteMany?: (args: Record<string, unknown>) => { count: number };
    queryRaw?: () => unknown;
  } = {},
) {
  const calls: Call[] = [];
  const record =
    <T>(op: string, handler: ((args: Record<string, unknown>) => T) | undefined, fallback: T) =>
    (args: Record<string, unknown>): Promise<T> => {
      calls.push({ op, args });
      return Promise.resolve(handler === undefined ? fallback : handler(args));
    };
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "raw", args: { sql: strings.join("?"), values } });
      return Promise.resolve(1);
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "queryRaw", args: { sql: strings.join("?"), values } });
      return Promise.resolve(handlers.queryRaw?.() ?? []);
    },
    trackingProfile: {
      findFirst: record("findFirst", handlers.findFirst, null),
      findMany: record("findMany", handlers.findMany, []),
      createMany: record("createMany", handlers.createMany, { count: 1 }),
      updateMany: record("updateMany", handlers.updateMany, { count: 1 }),
      deleteMany: record("deleteMany", handlers.deleteMany, { count: 0 }),
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    $queryRaw: tx.$queryRaw,
  } as unknown as Database;
  return { db, calls };
}

let ids = 0;
const store = (db: Database) =>
  new PrismaTrackingProfileStore(db, { generate: () => `id-${String((ids += 1))}` });

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "id-0",
    tenantId: "t-1",
    visitorId: "v-1",
    mergedInto: null,
    customerId: null,
    emailStd: null,
    emailGads: null,
    emailGa4: null,
    phoneDigits: null,
    phoneE164: null,
    fn: null,
    ln: null,
    ct: null,
    st: null,
    country: null,
    externalId: null,
    clickIds: {},
    fbp: null,
    fbc: null,
    fbcCapturedAt: null,
    ttp: null,
    scid: null,
    gaClientId: null,
    gaSessionId: null,
    lastIp: null,
    lastUserAgent: null,
    lastPageUrl: null,
    lastSeenAt: new Date(T0),
    geoCountry: null,
    geoRegion: null,
    geoCity: null,
    aiSource: null,
    botScore: null,
    fingerprintId: null,
    landingTouch: {},
    leadIds: [],
    orderIds: [],
    version: 3,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    expiresAt: new Date("2027-12-06T10:00:00.000Z"),
    ...overrides,
  };
}

function profile(extra: Partial<TrackingProfile> = {}): TrackingProfile {
  return { ...createProfile({ tenantId: "t-1", visitorId: "v-1", at: T0, now: T0 }), ...extra };
}

const ops = (calls: readonly Call[]): string[] => calls.map((call) => call.op);

describe("PrismaTrackingProfileStore — tenancy", () => {
  it("every read sets the tenant first and names it in the where", async () => {
    const { db, calls } = fakeDb({ findFirst: () => row({ emailStd: "e-1" }) });
    const s = store(db);

    await s.findByEmailHash("t-1", "e-1");
    await s.findByPhoneHash("t-1", "p-1");
    await s.findByCustomerId("t-1", "c-1");

    expect(
      calls.filter((c) => c.op === "raw").map((c) => (c.args as { values: unknown[] }).values),
    ).toEqual([["t-1"], ["t-1"], ["t-1"]]);
    expect(ops(calls)).toEqual(["raw", "findFirst", "raw", "findFirst", "raw", "findFirst"]);
    for (const call of calls.filter((c) => c.op === "findFirst")) {
      expect((call.args as { where: { tenantId: string; mergedInto: null } }).where).toMatchObject({
        tenantId: "t-1",
        mergedInto: null,
      });
    }
    // the newest sighting wins, stably
    expect((calls[1]?.args as { orderBy: unknown }).orderBy).toEqual([
      { lastSeenAt: "desc" },
      { visitorId: "asc" },
    ]);
  });

  it("a cookie id follows exactly one tombstone hop, inside the same tenant", async () => {
    const answers = [
      row({ visitorId: "v-alias", mergedInto: "v-main" }),
      row({ visitorId: "v-main" }),
    ];
    const { db, calls } = fakeDb({ findFirst: () => answers.shift() });

    const found = await store(db).findByVisitorId("t-1", "v-alias");

    expect(found?.visitorId).toBe("v-main");
    const lookups = calls
      .filter((c) => c.op === "findFirst")
      .map((c) => (c.args as { where: unknown }).where);
    expect(lookups).toEqual([
      { tenantId: "t-1", visitorId: "v-alias" },
      { tenantId: "t-1", visitorId: "v-main", mergedInto: null },
    ]);
  });

  it("a tombstone whose survivor is gone resolves to nothing", async () => {
    const answers = [row({ visitorId: "v-alias", mergedInto: "v-gone" }), null];
    const { db } = fakeDb({ findFirst: () => answers.shift() });
    expect(await store(db).findByVisitorId("t-1", "v-alias")).toBeNull();
  });

  it("the cross-tenant retention scan is a raw read behind the explicit retention switch, and only reads", async () => {
    const { db, calls } = fakeDb({ queryRaw: () => [{ tenant_id: "t-1" }, { tenant_id: "t-9" }] });
    const tenants = await store(db).tenantsWithExpiredProfiles(
      new Date("2026-11-27T10:00:00.000Z"),
    );

    expect(tenants).toEqual(["t-1", "t-9"]);
    expect(ops(calls)).toEqual(["raw", "queryRaw"]);
    expect((calls[0]?.args as { sql: string }).sql).toContain("app.retention_scan");
    const sql = (calls[1]?.args as { sql: string }).sql;
    expect(sql).toContain("customer_id IS NULL");
    expect(sql).toContain("SELECT DISTINCT tenant_id");
    expect(sql).not.toMatch(/DELETE|UPDATE/u);
  });

  it("expiry deletes only anonymous profiles of ONE tenant, sparing a customer's cookie tombstones", async () => {
    const { db, calls } = fakeDb();
    const now = new Date("2026-11-27T10:00:00.000Z");

    expect(await store(db).deleteExpiredAnonymous("t-1", now)).toBe(1); // the fake's $executeRaw count
    const raw = calls.find(
      (c) => c.op === "raw" && /DELETE/u.test((c.args as { sql: string }).sql),
    );
    const { sql, values } = raw?.args as { sql: string; values: unknown[] };
    expect(values).toEqual(["t-1", now.toISOString()]);
    expect(sql).toMatch(/p\.tenant_id = \?/u);
    expect(sql).toMatch(/p\.customer_id IS NULL/u);
    expect(sql).toMatch(/p\.expires_at < \?::timestamp/u);
    // a tombstone whose survivor carries a customer is not the clock's to delete
    expect(sql).toMatch(/NOT EXISTS[\s\S]*s\.customer_id IS NOT NULL/u);
  });

  it("erasing a customer deletes their profiles and the cookies pointing at them, scoped to the tenant", async () => {
    const { db, calls } = fakeDb({
      findMany: () => [{ visitorId: "v-1" }, { visitorId: "v-2" }],
      deleteMany: () => ({ count: 5 }),
    });

    expect(await store(db).eraseCustomer("t-1", "c-1")).toBe(5);
    expect((calls.find((c) => c.op === "findMany")?.args as { where: unknown }).where).toEqual({
      tenantId: "t-1",
      customerId: "c-1",
      mergedInto: null,
    });
    expect((calls.find((c) => c.op === "deleteMany")?.args as { where: unknown }).where).toEqual({
      tenantId: "t-1",
      OR: [{ visitorId: { in: ["v-1", "v-2"] } }, { mergedInto: { in: ["v-1", "v-2"] } }],
    });
  });

  it("erasing a customer with no profile deletes nothing", async () => {
    const { db, calls } = fakeDb({ findMany: () => [] });
    expect(await store(db).eraseCustomer("t-1", "c-404")).toBe(0);
    expect(calls.some((c) => c.op === "deleteMany")).toBe(false);
  });
});

describe("PrismaTrackingProfileStore — persist", () => {
  it("creates with skipDuplicates at version 1, clearing a dangling tombstone of the same cookie id first", async () => {
    const { db, calls } = fakeDb();
    const stored = await store(db).persist({
      profile: profile({
        hashes: { emailStd: "e-1" },
        clickIds: { ttclid: { value: "tt", capturedAt: T0 } },
      }),
      aliases: [],
      absorbed: [],
    });

    expect(stored).toBe(true);
    expect(ops(calls)).toEqual(["raw", "deleteMany", "createMany"]);
    expect((calls[1]?.args as { where: unknown }).where).toEqual({
      tenantId: "t-1",
      visitorId: "v-1",
      mergedInto: { not: null },
    });
    const create = calls[2]?.args as { skipDuplicates: boolean; data: Record<string, unknown>[] };
    expect(create.skipDuplicates).toBe(true);
    expect(create.data[0]).toMatchObject({
      tenantId: "t-1",
      visitorId: "v-1",
      emailStd: "e-1",
      version: 1,
      mergedInto: null,
      clickIds: { ttclid: { value: "tt", capturedAt: T0 } },
    });
  });

  it("a create that finds the profile already there is a lost race (false), not an error", async () => {
    const { db } = fakeDb({ createMany: () => ({ count: 0 }) });
    expect(await store(db).persist({ profile: profile(), aliases: [], absorbed: [] })).toBe(false);
  });

  it("an update is conditional on the version that was read and moves it forward", async () => {
    const { db, calls } = fakeDb();
    await store(db).persist({ profile: profile({ version: 3 }), aliases: [], absorbed: [] });

    const update = calls.find((c) => c.op === "updateMany")?.args as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toEqual({
      tenantId: "t-1",
      visitorId: "v-1",
      mergedInto: null,
      version: 3,
    });
    expect(update.data["version"]).toBe(4);
    expect(update.data).not.toHaveProperty("tenantId");
    expect(update.data).not.toHaveProperty("visitorId");
  });

  it("an update that matched no row (the version moved) is a lost race", async () => {
    const { db } = fakeDb({ updateMany: () => ({ count: 0 }) });
    expect(
      await store(db).persist({ profile: profile({ version: 3 }), aliases: [], absorbed: [] }),
    ).toBe(false);
  });

  it("absorbed profiles become data-free tombstones pointing at the survivor, each only at its read version", async () => {
    const { db, calls } = fakeDb();
    await store(db).persist({
      profile: profile({ version: 2 }),
      aliases: [],
      absorbed: [{ visitorId: "v-absorbed", version: 5 }],
    });

    const [, tombstone] = calls
      .filter((c) => c.op === "updateMany")
      .map(
        (c) =>
          c.args as {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          },
      );
    expect(tombstone?.where).toEqual({
      tenantId: "t-1",
      visitorId: "v-absorbed",
      mergedInto: null,
      version: 5,
    });
    expect(tombstone?.data).toMatchObject({
      mergedInto: "v-1",
      customerId: null,
      emailStd: null,
      emailGads: null,
      emailGa4: null,
      phoneDigits: null,
      phoneE164: null,
      fn: null,
      ln: null,
      ct: null,
      st: null,
      country: null,
      externalId: null,
      clickIds: {},
      fbp: null,
      fbc: null,
      ttp: null,
      scid: null,
      gaClientId: null,
      gaSessionId: null,
      lastIp: null,
      lastUserAgent: null,
      lastPageUrl: null,
      leadIds: [],
      orderIds: [],
      landingTouch: {},
      version: 6,
    });
  });

  it("an absorbed profile that moved on makes the whole change a lost race", async () => {
    let updates = 0;
    const { db } = fakeDb({ updateMany: () => ({ count: (updates += 1) === 1 ? 1 : 0 }) });
    const stored = await store(db).persist({
      profile: profile({ version: 2 }),
      aliases: [],
      absorbed: [{ visitorId: "v-absorbed", version: 5 }],
    });
    expect(stored).toBe(false);
  });

  it("a new cookie alias is refreshed if it already resolves, else created as a tombstone", async () => {
    const created: Record<string, unknown>[] = [];
    let call = 0;
    const { db, calls } = fakeDb({
      updateMany: () => ({ count: (call += 1) === 1 ? 1 : 0 }), // the profile itself, then: alias not found
      createMany: (args) => {
        created.push(...(args["data"] as Record<string, unknown>[]));
        return { count: 1 };
      },
    });

    expect(
      await store(db).persist({
        profile: profile({ version: 1 }),
        aliases: ["v-new-device"],
        absorbed: [],
      }),
    ).toBe(true);
    expect(ops(calls)).toEqual(["raw", "updateMany", "updateMany", "createMany"]);
    expect(created[0]).toMatchObject({
      visitorId: "v-new-device",
      mergedInto: "v-1",
      emailStd: null,
      version: 1,
    });
  });

  it("an alias that is a live profile of someone else's making is a lost race, not an overwrite", async () => {
    let call = 0;
    const { db } = fakeDb({
      updateMany: () => ({ count: (call += 1) === 1 ? 1 : 0 }),
      createMany: () => ({ count: 0 }),
    });
    expect(
      await store(db).persist({
        profile: profile({ version: 1 }),
        aliases: ["v-live"],
        absorbed: [],
      }),
    ).toBe(false);
  });

  it("an unexpected database error is thrown, not swallowed as a conflict", async () => {
    const { db } = fakeDb({
      createMany: () => {
        throw new Error("connection reset");
      },
    });
    await expect(
      store(db).persist({ profile: profile(), aliases: [], absorbed: [] }),
    ).rejects.toThrow("connection reset");
  });
});

describe("toProfile", () => {
  it("maps nulls to absent fields and an empty landing marker to no landing touch", () => {
    const mapped = toProfile(row());
    expect(mapped.hashes).toEqual({});
    expect(mapped.browser).toEqual({});
    expect(mapped.customerId).toBeUndefined();
    expect(mapped.landing).toBeUndefined();
    expect(mapped.geo).toBeUndefined();
    expect(mapped.version).toBe(3);
  });

  it("maps every stored value back, ISO dates and all", () => {
    const mapped = toProfile(
      row({
        customerId: "c-1",
        emailStd: "e",
        phoneE164: "p",
        clickIds: { ttclid: { value: "tt", capturedAt: T0 } },
        fbc: "fb.1.1.x",
        fbcCapturedAt: new Date(T0),
        gaClientId: "1.2",
        lastIp: "203.0.113.7",
        geoCountry: "EG",
        landingTouch: { utmSource: "meta", at: T0 },
        leadIds: ["l-1"],
      }),
    );
    expect(mapped).toMatchObject({
      customerId: "c-1",
      hashes: { emailStd: "e", phoneE164: "p" },
      clickIds: { ttclid: { value: "tt", capturedAt: T0 } },
      browser: { fbc: "fb.1.1.x", fbcCapturedAt: T0, gaClientId: "1.2" },
      lastIp: "203.0.113.7",
      geo: { country: "EG" },
      landing: { utmSource: "meta", at: T0 },
      leadIds: ["l-1"],
      lastSeenAt: T0,
    });
  });
});

describe("PrismaTrackingProfileStore — cookieless id lookup (P1-D8)", () => {
  it("asks for live, recent profiles of this tenant only, at most two, newest first", async () => {
    const { db, calls } = fakeDb({ findMany: () => [row({ fingerprintId: "f".repeat(32) })] });
    const since = new Date("2026-11-20T00:00:00.000Z");
    const found = await store(db).findByFingerprintId("t-1", "f".repeat(32), since);

    expect(found.map((profile) => profile.visitorId)).toEqual(["v-1"]);
    expect(ops(calls)).toEqual(["raw", "findMany"]);
    expect(calls[0]?.args).toMatchObject({ values: expect.arrayContaining(["t-1"]) });
    expect(calls[1]?.args).toEqual({
      where: {
        tenantId: "t-1",
        mergedInto: null,
        fingerprintId: "f".repeat(32),
        lastSeenAt: { gte: since },
      },
      orderBy: [{ lastSeenAt: "desc" }, { visitorId: "asc" }],
      take: 2,
    });
  });
});
