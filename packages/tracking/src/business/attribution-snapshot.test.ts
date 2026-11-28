import { beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryAttributionSnapshotStore,
  recordAttributionSnapshot,
  sanitizeAttributionSnapshot,
} from "./attribution-snapshot";

beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-12-01T10:00:00.000Z");
const VISITOR = "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b";
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString();

describe("sanitizeAttributionSnapshot", () => {
  it("keeps a well-formed snapshot field for field", () => {
    const snapshot = sanitizeAttributionSnapshot(
      {
        visitorId: VISITOR,
        sessionId: "sess-1",
        ip: "203.0.113.9",
        userAgent: "Mozilla/5.0 (Linux; Android 14)",
        pageUrl: "https://shop.example/checkout",
        referrer: "https://www.google.com/",
        cookies: { fbp: "fb.1.1.2", fbc: "fb.1.1700000000000.abc", ga: "GA1.1.123.456" },
        clickIds: [{ name: "gclid", value: "Cj0KCQ-abc", capturedAt: iso(-2 * DAY) }],
        utm: { source: "facebook", campaign: "eid" },
      },
      NOW,
    );
    expect(snapshot).toEqual({
      visitorId: VISITOR,
      sessionId: "sess-1",
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      pageUrl: "https://shop.example/checkout",
      referrer: "https://www.google.com/",
      cookies: { fbp: "fb.1.1.2", fbc: "fb.1.1700000000000.abc", ga: "GA1.1.123.456" },
      clickIds: [{ name: "gclid", value: "Cj0KCQ-abc", capturedAt: iso(-2 * DAY) }],
      utm: { source: "facebook", campaign: "eid" },
    });
  });

  it("drops what is not valid and returns null when nothing is left", () => {
    expect(
      sanitizeAttributionSnapshot(
        {
          visitorId: "short",
          sessionId: "has space",
          ip: "not-an-ip",
          userAgent: "   ",
          pageUrl: "javascript:alert(1)",
          referrer: "ftp://x",
          cookies: { fbp: "" },
          clickIds: [],
          utm: {},
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("validates click ids: name, value shape, platform window, future clock", () => {
    const snapshot = sanitizeAttributionSnapshot(
      {
        clickIds: [
          { name: "gclid", value: "fresh", capturedAt: iso(-1 * DAY) },
          // Snapchat's window is 28 days: 30 days old is past it
          { name: "scclid", value: "old", capturedAt: iso(-30 * DAY) },
          // 89 days is inside Meta's 90
          { name: "fbclid", value: "inwindow", capturedAt: iso(-89 * DAY) },
          { name: "ttclid", value: "x".repeat(1000), capturedAt: iso(-1 * DAY) },
          // longer than 512 for a non-TikTok id: refused, never truncated
          { name: "msclkid", value: "y".repeat(513), capturedAt: iso(-1 * DAY) },
          { name: "twclid", value: "bad value!", capturedAt: iso(-1 * DAY) },
          { name: "not_a_click", value: "abc", capturedAt: iso(-1 * DAY) },
          { name: "epik", value: "abc", capturedAt: "yesterday" },
          // a client clock a little ahead is clamped; a day ahead is dropped
          { name: "wbraid", value: "ahead-a-bit", capturedAt: iso(2 * 60_000) },
          { name: "gbraid", value: "ahead-a-day", capturedAt: iso(DAY) },
        ],
      },
      NOW,
    );
    expect(snapshot?.clickIds?.map((click) => click.name).sort()).toEqual(
      ["fbclid", "gclid", "ttclid", "wbraid"].sort(),
    );
    const wbraid = snapshot?.clickIds?.find((click) => click.name === "wbraid");
    expect(wbraid?.capturedAt).toBe(NOW.toISOString());
  });

  it("keeps one entry per click name (the latest) and at most one per registered name", () => {
    const snapshot = sanitizeAttributionSnapshot(
      {
        clickIds: [
          { name: "gclid", value: "older", capturedAt: iso(-3 * DAY) },
          { name: "gclid", value: "newer", capturedAt: iso(-1 * DAY) },
        ],
      },
      NOW,
    );
    expect(snapshot?.clickIds).toEqual([
      { name: "gclid", value: "newer", capturedAt: iso(-1 * DAY) },
    ]);
  });

  it("strips control characters and caps labels", () => {
    const snapshot = sanitizeAttributionSnapshot(
      {
        userAgent: "Agent\u0000\u0007 1.0",
        utm: { source: `a${"b".repeat(400)}`, medium: "\u0001" },
      },
      NOW,
    );
    expect(snapshot?.userAgent).toBe("Agent 1.0");
    expect(snapshot?.utm?.source).toHaveLength(200);
    expect(snapshot?.utm?.medium).toBeUndefined();
  });

  it("refuses values past the size caps instead of truncating them", () => {
    const snapshot = sanitizeAttributionSnapshot(
      {
        pageUrl: `https://shop.example/${"a".repeat(2100)}`,
        userAgent: "u".repeat(513),
        cookies: { fbp: "f".repeat(513), ga: "GA1.1.1.2" },
      },
      NOW,
    );
    expect(snapshot).toEqual({ cookies: { ga: "GA1.1.1.2" } });
  });
});

describe("recordAttributionSnapshot and the in-memory store", () => {
  const input = { visitorId: VISITOR, ip: "203.0.113.9" };

  it("stores once per subject: the first write wins, a second is 'exists' and changes nothing", async () => {
    const store = new InMemoryAttributionSnapshotStore();
    const first = await recordAttributionSnapshot({
      store,
      now: NOW,
      tenantId: "t-1",
      subjectKind: "checkout",
      subjectRef: "chk-1",
      input,
    });
    const second = await recordAttributionSnapshot({
      store,
      now: new Date(NOW.getTime() + 1000),
      tenantId: "t-1",
      subjectKind: "checkout",
      subjectRef: "chk-1",
      input: { visitorId: "ffffffff-ffff-4fff-8fff-ffffffffffff", ip: "198.51.100.1" },
    });
    expect(first).toBe("created");
    expect(second).toBe("exists");
    expect(await store.find("t-1", "checkout", "chk-1")).toEqual({
      visitorId: VISITOR,
      ip: "203.0.113.9",
    });
  });

  it("keeps tenants and subject kinds apart", async () => {
    const store = new InMemoryAttributionSnapshotStore();
    const base = { store, now: NOW, subjectRef: "same", input };
    await recordAttributionSnapshot({ ...base, tenantId: "t-1", subjectKind: "checkout" });
    expect(await store.find("t-2", "checkout", "same")).toBeNull();
    expect(await store.find("t-1", "lead", "same")).toBeNull();
    expect(await store.find("t-1", "checkout", "same")).not.toBeNull();
  });

  it("writes nothing when the input has nothing usable", async () => {
    const store = new InMemoryAttributionSnapshotStore();
    const outcome = await recordAttributionSnapshot({
      store,
      now: NOW,
      tenantId: "t-1",
      subjectKind: "checkout",
      subjectRef: "chk-1",
      input: { visitorId: "bad" },
    });
    expect(outcome).toBe("empty");
    expect(await store.find("t-1", "checkout", "chk-1")).toBeNull();
  });

  it("refuses an empty tenant or subject", async () => {
    const store = new InMemoryAttributionSnapshotStore();
    await expect(
      recordAttributionSnapshot({
        store,
        now: NOW,
        tenantId: " ",
        subjectKind: "checkout",
        subjectRef: "chk-1",
        input,
      }),
    ).rejects.toThrow(/tenantId/u);
    await expect(
      recordAttributionSnapshot({
        store,
        now: NOW,
        tenantId: "t-1",
        subjectKind: "checkout",
        subjectRef: "",
        input,
      }),
    ).rejects.toThrow(/subjectRef/u);
  });

  it("deleteSubjects removes only the named subjects of that tenant", async () => {
    const store = new InMemoryAttributionSnapshotStore();
    for (const [tenantId, ref] of [
      ["t-1", "a"],
      ["t-1", "b"],
      ["t-2", "a"],
    ] as const) {
      await recordAttributionSnapshot({
        store,
        now: NOW,
        tenantId,
        subjectKind: "checkout",
        subjectRef: ref,
        input,
      });
    }
    expect(await store.deleteSubjects("t-1", "checkout", ["a", "zzz"])).toBe(1);
    expect(await store.find("t-1", "checkout", "a")).toBeNull();
    expect(await store.find("t-1", "checkout", "b")).not.toBeNull();
    expect(await store.find("t-2", "checkout", "a")).not.toBeNull();
  });
});

describe("in-memory retention (D8)", () => {
  it("nulls IP and user agent after the network cutoff, keeps the rest, then deletes after the long cutoff", async () => {
    const store = new InMemoryAttributionSnapshotStore();
    const write = (ref: string, at: Date) =>
      recordAttributionSnapshot({
        store,
        now: at,
        tenantId: "t-1",
        subjectKind: "checkout",
        subjectRef: ref,
        input: {
          visitorId: VISITOR,
          ip: "203.0.113.9",
          userAgent: "UA",
          pageUrl: "https://s.example/",
        },
      });
    const old = new Date(NOW.getTime() - 100 * DAY);
    const ancient = new Date(NOW.getTime() - 401 * DAY);
    await write("fresh", NOW);
    await write("old", old);
    await write("ancient", ancient);

    const cutoff90 = new Date(NOW.getTime() - 90 * DAY);
    const cutoff400 = new Date(NOW.getTime() - 400 * DAY);
    expect(await store.tenantsWithSnapshotWork(cutoff90, cutoff400)).toEqual(["t-1"]);

    expect(await store.redactNetworkBatch("t-1", cutoff90, 10, NOW)).toBe(2);
    expect(await store.redactNetworkBatch("t-1", cutoff90, 10, NOW)).toBe(0);
    expect(await store.find("t-1", "checkout", "old")).toEqual({
      visitorId: VISITOR,
      userAgent: undefined,
      pageUrl: "https://s.example/",
    });
    expect(await store.find("t-1", "checkout", "fresh")).toMatchObject({ ip: "203.0.113.9" });

    expect(await store.deleteExpiredBatch("t-1", cutoff400, 10)).toBe(1);
    expect(await store.find("t-1", "checkout", "ancient")).toBeNull();
    expect(await store.find("t-1", "checkout", "old")).not.toBeNull();
    expect(await store.tenantsWithSnapshotWork(cutoff90, cutoff400)).toEqual([]);
  });
});
