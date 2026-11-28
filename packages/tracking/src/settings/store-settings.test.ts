import { beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryTrackingSettingsStore,
  TrackingSettingsService,
  defaultTrackingSettings,
  type TrackingSettingsStore,
} from "./store-settings";

beforeEach(() => {
  expect.hasAssertions();
});

function harness(overrides: Partial<{ cacheTtlMs: number }> = {}) {
  let nowMs = Date.parse("2026-11-28T10:00:00.000Z");
  const store = new InMemoryTrackingSettingsStore();
  const errors: unknown[] = [];
  const service = new TrackingSettingsService({
    store,
    clock: { now: () => new Date(nowMs) },
    onError: (error) => errors.push(error),
    ...overrides,
  });
  return {
    store,
    service,
    errors,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("TrackingSettingsService", () => {
  it("a store with no row has the defaults: notice_only, notice shown, version 0", async () => {
    const { service } = harness();
    expect(await service.get("t-1")).toEqual({
      tenantId: "t-1",
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      version: 0,
      updatedAt: null,
    });
    expect(defaultTrackingSettings("t-1").version).toBe(0);
  });

  it("the first save needs expectedVersion 0 and creates version 1", async () => {
    const { service } = harness();
    const saved = await service.update("t-1", {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: false,
      expectedVersion: 0,
    });
    expect(saved).toEqual({
      status: "saved",
      settings: {
        tenantId: "t-1",
        consentPolicy: "opt_in",
        cookieNoticeEnabled: false,
        version: 1,
        updatedAt: "2026-11-28T10:00:00.000Z",
      },
    });
    expect((await service.get("t-1")).consentPolicy).toBe("opt_in");
  });

  it("a stale expectedVersion is a conflict that carries the current settings and changes nothing", async () => {
    const { service } = harness();
    await service.update("t-1", {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    const stale = await service.update("t-1", {
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    expect(stale).toMatchObject({ status: "conflict", current: { version: 1 } });
    expect((await service.get("t-1")).consentPolicy).toBe("opt_in");
    const next = await service.update("t-1", {
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      expectedVersion: 1,
    });
    expect(next).toMatchObject({ status: "saved", settings: { version: 2 } });
  });

  it("settings of two stores never mix", async () => {
    const { service } = harness();
    await service.update("t-a", {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: false,
      expectedVersion: 0,
    });
    expect(await service.get("t-b")).toMatchObject({
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      version: 0,
    });
    expect(await service.consentPolicyFor("t-b")).toBe("notice_only");
    expect(await service.consentPolicyFor("t-a")).toBe("opt_in");
  });

  it("consentPolicyFor is cached for 30 s, and an edit through this service shows at once", async () => {
    const { service, store, advance } = harness();
    let reads = 0;
    const original = store.get.bind(store);
    store.get = (tenantId: string) => {
      reads += 1;
      return original(tenantId);
    };
    expect(await service.consentPolicyFor("t-1")).toBe("notice_only");
    expect(await service.consentPolicyFor("t-1")).toBe("notice_only");
    expect(reads).toBe(1);

    await service.update("t-1", {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    expect(await service.consentPolicyFor("t-1")).toBe("opt_in");

    advance(29_000);
    const before = reads;
    await service.consentPolicyFor("t-1");
    expect(reads).toBe(before);
    advance(2_000);
    await service.consentPolicyFor("t-1");
    expect(reads).toBe(before + 1);
  });

  it("an unreadable store falls back to notice_only (fail open), never throws, and logs once a minute per tenant", async () => {
    const { service, store, errors, advance } = harness();
    store.failWith = new Error("db is down");
    expect(await service.consentPolicyFor("t-1")).toBe("notice_only");
    expect(await service.cookieNoticeEnabledFor("t-1")).toBe(true);
    advance(31_000);
    expect(await service.consentPolicyFor("t-1")).toBe("notice_only");
    expect(errors).toHaveLength(1);
    advance(31_000);
    expect(await service.consentPolicyFor("t-1")).toBe("notice_only");
    expect(errors).toHaveLength(2);
    // another tenant has its own budget
    await service.consentPolicyFor("t-2");
    expect(errors).toHaveLength(3);
  });

  it("an opt_in store whose row becomes unreadable is NOT silently kept opt_in: the documented fallback is notice_only", async () => {
    const { service, store, advance } = harness();
    await service.update("t-1", {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    advance(31_000);
    store.failWith = new Error("db is down");
    expect(await service.consentPolicyFor("t-1")).toBe("notice_only");
  });

  it("get() (the admin read) surfaces a store error instead of pretending defaults", async () => {
    const { service, store } = harness();
    store.failWith = new Error("db is down");
    await expect(service.get("t-1")).rejects.toThrow("db is down");
  });

  it("works against any store honouring the port", async () => {
    const calls: string[] = [];
    const store: TrackingSettingsStore = {
      get: (tenantId) => {
        calls.push(`get:${tenantId}`);
        return Promise.resolve(null);
      },
      save: () => Promise.resolve(null),
    };
    const service = new TrackingSettingsService({ store, clock: { now: () => new Date() } });
    const result = await service.update("t-9", {
      consentPolicy: "notice_only",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    expect(result).toMatchObject({ status: "conflict", current: { version: 0 } });
    expect(calls).toContain("get:t-9");
  });
});
