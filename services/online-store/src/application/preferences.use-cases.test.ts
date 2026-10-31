import { describe, expect, it } from "vitest";
import { harness } from "../testing/fakes";

const T = "t-1";

describe("preferences use cases", () => {
  it("reads the defaults with the store name", async () => {
    const { controller } = harness({ names: { [T]: "Nour" } });
    expect(await controller.getPreferences({ tenantId: T })).toEqual({
      status: 200,
      body: {
        homeTitle: {},
        homeMetaDescription: {},
        shareImage: null,
        shareImageId: null,
        defaultLocale: "ar",
        storeName: "Nour",
        version: 0,
      },
    });
  });

  it("saves normalised text, an owned share image, and records the event", async () => {
    const { controller, recorded } = harness({ owned: { [T]: ["og-1"] } });
    const res = await controller.updatePreferences({
      tenantId: T,
      homeTitle: { ar: "  متجر\u202E النور ", en: "" },
      homeMetaDescription: { en: "Hand-made" },
      shareImageId: "og-1",
      defaultLocale: "en",
      expectedVersion: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      homeTitle: { ar: "متجر النور" },
      homeMetaDescription: { en: "Hand-made" },
      shareImage: { url: "https://cdn.test/og-1.png" },
      shareImageId: "og-1",
      defaultLocale: "en",
      version: 1,
    });
    expect(recorded).toEqual([{ tenantId: T, type: "online_store.preferences.updated" }]);
  });

  it("refuses a 71-character title, a foreign share image and a stale version", async () => {
    const { controller } = harness({ owned: { other: ["og-x"] } });
    const long = await controller.updatePreferences({
      tenantId: T,
      homeTitle: { en: "x".repeat(71) },
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(long.body).toMatchObject({ fields: [{ field: "homeTitle.en", message: "TOO_LONG" }] });
    const foreign = await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: "og-x",
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(foreign.body).toMatchObject({ code: "IMAGE_NOT_FOUND" });
    await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    const stale = await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(stale.body).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("keeps the stored share image id when the image can no longer be resolved", async () => {
    const owned: Record<string, string[]> = { [T]: ["og-1"] };
    const { controller } = harness({ owned });
    await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: "og-1",
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    owned[T] = [];
    expect((await controller.getPreferences({ tenantId: T })).body).toMatchObject({
      shareImage: null,
      shareImageId: "og-1",
    });
  });
});
