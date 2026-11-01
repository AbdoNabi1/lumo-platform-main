import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { logger } from "@platform/utils";
import { harness } from "../testing/fakes";

type Doc = ReturnType<typeof JSON.parse>;

const T = "t-1";

describe("GetStorefrontShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("a media failure blanks only the images, on live and preview, and is logged", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const options = {
      owned: { [T]: ["logo-1", "icon-1", "og-1"] },
      names: { [T]: "متجر النور" },
      imageResolveFails: false,
    };
    const { controller } = harness(options);
    const draft = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    draft.brand.logo.imageRef = "logo-1";
    draft.brand.favicon.imageRef = "icon-1";
    draft.brand.colors.primary = "#0f5132";
    draft.brand.typography.baseSize = "large";
    draft.brand.corners = "pill";
    draft.footer.note = { ar: "شكرًا" };
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    await controller.updatePreferences({
      tenantId: T,
      homeTitle: { en: "Nour" },
      homeMetaDescription: {},
      shareImageId: "og-1",
      defaultLocale: "en",
      expectedVersion: 0,
    });
    const token = (
      (await controller.issuePreviewToken({ tenantId: T, createdBy: "s" })).body as {
        token: string;
      }
    ).token;
    const healthy = (await controller.shell({ tenantId: T })).body as Doc;
    expect(healthy.brand.logo.image).not.toBeNull();
    expect(healthy.brand.favicon).not.toBeNull();
    expect(healthy.preferences.shareImage).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();

    options.imageResolveFails = true;
    const degraded = await controller.shell({ tenantId: T });
    expect(degraded.status).toBe(200);
    expect(degraded.body).toEqual({
      ...healthy,
      preferences: { ...healthy.preferences, shareImage: null },
      brand: {
        ...healthy.brand,
        logo: { image: null, widthPx: healthy.brand.logo.widthPx },
        favicon: null,
      },
    });
    expect(degraded.body).toMatchObject({
      storeName: "متجر النور",
      defaultLocale: "en",
      brand: { colors: { primary: "#0f5132" }, typography: { baseSize: "large" }, corners: "pill" },
    });
    expect(warn).toHaveBeenCalledWith("storefront shell: images unavailable", {
      tenantId: T,
      error: "media down",
    });

    // 200 still means a valid token: the check runs before this read.
    const preview = await controller.shell({ tenantId: T, previewToken: token });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ mode: "preview", brand: { favicon: null } });
    expect((await controller.shell({ tenantId: T, previewToken: "a".repeat(43) })).status).toBe(
      401,
    );
  });

  it("an image failure still surfaces on the admin read, as an error and not a removed image", async () => {
    const options = { owned: { [T]: ["logo-1"] }, imageResolveFails: false };
    const { controller } = harness(options);
    const draft = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    draft.brand.logo.imageRef = "logo-1";
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    options.imageResolveFails = true;
    await expect(controller.getTheme({ tenantId: T })).rejects.toThrow("media down");
  });

  it("an unknown preview token never reaches the draft", async () => {
    const { controller } = harness();
    const res = await controller.shell({ tenantId: T, previewToken: "a".repeat(43) });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("brand");
  });
});
