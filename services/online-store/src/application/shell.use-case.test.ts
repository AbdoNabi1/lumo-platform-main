import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { harness } from "../testing/fakes";

type Doc = ReturnType<typeof JSON.parse>;

const T = "t-1";

describe("GetStorefrontShell", () => {
  it("an untouched shop: live, default brand, unbranded, Arabic, unlocked", async () => {
    const { controller } = harness({ names: { [T]: "متجر النور" } });
    const res = await controller.shell({ tenantId: T });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      mode: "live",
      previewExpiresAt: null,
      branded: false,
      storeName: "متجر النور",
      defaultLocale: "ar",
      preferences: { homeTitle: {}, homeMetaDescription: {}, shareImage: null },
      brand: {
        logo: { image: null, widthPx: 140 },
        favicon: null,
        colors: DEFAULT_THEME_DOCUMENT.brand.colors,
        typography: DEFAULT_THEME_DOCUMENT.brand.typography,
        corners: "rounded",
        social: {},
      },
      header: { sticky: false },
      footer: { note: {}, showSocial: true },
      locked: false,
    });
  });

  it("live shows the published document, preview shows the draft", async () => {
    const { controller } = harness({ owned: { [T]: ["logo-1"] } });
    const draft = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    draft.brand.logo.imageRef = "logo-1";
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    const live = (await controller.shell({ tenantId: T })).body as Doc;
    expect(live.brand.logo.image).toBeNull();
    const token = (
      (await controller.issuePreviewToken({ tenantId: T, createdBy: "s" })).body as {
        token: string;
      }
    ).token;
    const preview = (await controller.shell({ tenantId: T, previewToken: token })).body as Doc;
    expect(preview.mode).toBe("preview");
    expect(preview.previewExpiresAt).toBe("2026-10-27T11:00:00.000Z");
    expect(preview.branded).toBe(true);
    expect(preview.brand.logo.image).toEqual({
      url: "https://cdn.test/logo-1.png",
      alt: null,
      width: 64,
      height: 64,
    });
  });

  it("carries no tenant, storage key, revision, hash, version or accessVersion", async () => {
    const { controller } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    const json = JSON.stringify((await controller.shell({ tenantId: T })).body);
    for (const leak of [
      "t-1",
      "tenant",
      "Revision",
      "version",
      "hash",
      "accessVersion",
      "storageKey",
      "imageRef",
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(JSON.parse(json).locked).toBe(true);
  });

  it("a published shop is branded when live, and an unresolvable image is simply absent", async () => {
    const owned: Record<string, string[]> = { [T]: ["logo-1", "og-1"] };
    const { controller } = harness({ owned });
    const draft = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    draft.brand.logo.imageRef = "logo-1";
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: "og-1",
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    const live = (await controller.shell({ tenantId: T })).body as Doc;
    expect(live.branded).toBe(true);
    expect(live.mode).toBe("live");
    expect(live.brand.logo.image?.url).toBe("https://cdn.test/logo-1.png");
    expect(live.preferences.shareImage?.url).toBe("https://cdn.test/og-1.png");
    owned[T] = [];
    const gone = (await controller.shell({ tenantId: T })).body as Doc;
    expect(gone.brand.logo.image).toBeNull();
    expect(gone.preferences.shareImage).toBeNull();
  });

  it("an unknown preview token never reaches the draft", async () => {
    const { controller } = harness();
    const res = await controller.shell({ tenantId: T, previewToken: "a".repeat(43) });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("brand");
  });
});
