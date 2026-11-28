import { describe, expect, it } from "vitest";
import {
  InMemoryTrackingProfileStore,
  createProfile,
  type TrackingProfile,
} from "@platform/tracking";
import type { RuntimeCore } from "../composition";
import { buildTrackingCookieKeeper, createTrackingCookieKeeper } from "./tracking-cookie-keeper";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const clock = { now: () => NOW };
const T = "2026-11-25T12:00:00.000Z";

async function seed(
  store: InMemoryTrackingProfileStore,
  tenantId: string,
  visitorId: string,
  browser: TrackingProfile["browser"],
  aliases: readonly string[] = [],
): Promise<void> {
  const base = createProfile({ tenantId, visitorId, at: T, now: T });
  const created = await store.persist({
    profile: { ...base, browser, version: 0 },
    aliases,
    absorbed: [],
  });
  expect(created).toBe(true);
}

describe("createTrackingCookieKeeper", () => {
  it("restores what the browser lost for the visitor's profile", async () => {
    const store = new InMemoryTrackingProfileStore();
    await seed(store, "shop-1", "mb-visitor-1", { fbp: "fb.1.1.1", ttp: "ttp-1" });
    const keeper = createTrackingCookieKeeper(store, clock);

    const cookies = await keeper({
      tenantId: "shop-1",
      visitorId: "mb-visitor-1",
      present: new Set(["_fbp"]),
    });

    expect(cookies.map((c) => c.name)).toEqual(["_ttp"]);
  });

  it("restores nothing for a visitor id that only exists under another tenant", async () => {
    const store = new InMemoryTrackingProfileStore();
    await seed(store, "shop-1", "mb-visitor-1", { fbp: "fb.1.1.1" });
    const keeper = createTrackingCookieKeeper(store, clock);

    expect(
      await keeper({ tenantId: "shop-2", visitorId: "mb-visitor-1", present: new Set() }),
    ).toEqual([]);
  });

  it("restores nothing for a visitor with no profile yet", async () => {
    const keeper = createTrackingCookieKeeper(new InMemoryTrackingProfileStore(), clock);

    expect(
      await keeper({ tenantId: "shop-1", visitorId: "mb-brand-new", present: new Set() }),
    ).toEqual([]);
  });

  it("follows a merged cookie id to the surviving profile", async () => {
    const store = new InMemoryTrackingProfileStore();
    await seed(store, "shop-1", "mb-visitor-1", { scid: "scid-1" }, ["mb-old-device"]);
    const keeper = createTrackingCookieKeeper(store, clock);

    const cookies = await keeper({
      tenantId: "shop-1",
      visitorId: "mb-old-device",
      present: new Set(),
    });

    expect(cookies).toEqual([{ name: "_scid", value: "scid-1", maxAgeSeconds: 400 * 86_400 }]);
  });
});

describe("buildTrackingCookieKeeper", () => {
  const core = (ingest: boolean) =>
    ({
      config: { TRACKING_INGEST_ENABLED: ingest },
      prisma: {},
      idGenerator: { generate: () => "id" },
      clock,
    }) as unknown as RuntimeCore;

  it("is absent while tracking ingest is off, so the capture route never reads an unmigrated table", () => {
    expect(buildTrackingCookieKeeper(core(false))).toBeNull();
  });

  it("exists once tracking ingest is on", () => {
    expect(buildTrackingCookieKeeper(core(true))).toBeTypeOf("function");
  });
});
