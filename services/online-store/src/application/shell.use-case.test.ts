import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      header: {
        sticky: false,
        menu: [
          { label: { ar: "الرئيسية", en: "Home" }, href: "/", external: false, children: [] },
          { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
        ],
        announcement: null,
      },
      footer: {
        note: {},
        showSocial: true,
        menu: [
          { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
        ],
        policies: [],
      },
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

describe("the shell's menus (spec 2.2, 2.6)", () => {
  const TARGETS = {
    [T]: { collection: { "c-1": { href: "/collections/sale", title: "Sale", published: true } } },
  };
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an untouched shop serves the default menus resolved, and no policy links", async () => {
    const body = (await harness().controller.shell({ tenantId: T })).body as Doc;
    expect(body.header.menu).toEqual([
      { label: { ar: "الرئيسية", en: "Home" }, href: "/", external: false, children: [] },
      { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
    ]);
    expect(body.footer.menu).toEqual([
      { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
    ]);
    expect(body.footer.policies).toEqual([]);
  });

  it("drops missing, unpublished and unset targets with their children; one batched read", async () => {
    const h = harness({ targets: TARGETS });
    await h.controller.updateMenu({
      tenantId: T,
      handle: "main-menu",
      title: "Main",
      expectedVersion: 0,
      items: [
        {
          id: ID(1),
          label: { en: "Sale" },
          link: { type: "collection", id: "c-1" },
          children: [
            {
              id: ID(2),
              label: { en: "Gone" },
              link: { type: "product", id: "p-x" },
              children: [],
            },
          ],
        },
        {
          id: ID(3),
          label: { en: "Old" },
          link: { type: "collection", id: "c-gone" },
          children: [{ id: ID(4), label: { en: "Kid" }, link: { type: "home" }, children: [] }],
        },
        {
          id: ID(5),
          label: { en: "Terms" },
          link: { type: "policy", policy: "terms" },
          children: [],
        },
        {
          id: ID(6),
          label: { en: "WhatsApp" },
          link: { type: "url", url: "https://wa.me/20100" },
          children: [],
        },
      ],
    });
    h.resolveCalls.splice(0); // the save's own view resolved too
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.header.menu).toEqual([
      { label: { en: "Sale" }, href: "/collections/sale", external: false, children: [] },
      { label: { en: "WhatsApp" }, href: "https://wa.me/20100", external: true, children: [] },
    ]);
    expect(h.resolveCalls).toEqual([3]);
  });

  it("link targets down: only catalogue items are dropped, logged; the shell still answers (Review Focus 2)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const targets = {
      [T]: {
        ...TARGETS[T],
        page: { "g-1": { href: "/pages/about", title: "About", published: true } },
      },
    };
    const options = { targets, linkTargetsFail: false };
    const h = harness(options);
    await h.controller.updatePolicy({
      tenantId: T,
      type: "terms",
      by: "s",
      expectedVersion: 0,
      body: { en: "x" },
    });
    await h.controller.updateMenu({
      tenantId: T,
      handle: "main-menu",
      title: "Main",
      expectedVersion: 0,
      items: [
        { id: ID(1), label: { en: "Sale" }, link: { type: "collection", id: "c-1" }, children: [] },
        { id: ID(2), label: { en: "Home" }, link: { type: "home" }, children: [] },
        { id: ID(3), label: { en: "About" }, link: { type: "page", id: "g-1" }, children: [] },
        { id: ID(4), label: { en: "Find" }, link: { type: "search" }, children: [] },
        {
          id: ID(5),
          label: { en: "Terms" },
          link: { type: "policy", policy: "terms" },
          children: [],
        },
        {
          id: ID(6),
          label: { en: "WhatsApp" },
          link: { type: "url", url: "https://wa.me/20100" },
          children: [],
        },
      ],
    });
    const healthy = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(healthy.header.menu.map((i: { href: string }) => i.href)).toEqual([
      "/collections/sale",
      "/",
      "/pages/about",
      "/search",
      "/policies/terms-of-service",
      "https://wa.me/20100",
    ]);
    options.linkTargetsFail = true; // read per call, as Part 1's ...Fails options
    const res = await h.controller.shell({ tenantId: T });
    expect(res.status).toBe(200);
    // Only the collection and the page drop; home, search, policy and URL links stay (Ruling 26).
    expect((res.body as Doc).header.menu).toEqual([
      { label: { en: "Home" }, href: "/", external: false, children: [] },
      { label: { en: "Find" }, href: "/search", external: false, children: [] },
      {
        label: { en: "Terms" },
        href: "/policies/terms-of-service",
        external: false,
        children: [],
      },
      { label: { en: "WhatsApp" }, href: "https://wa.me/20100", external: true, children: [] },
    ]);
    expect(warn).toHaveBeenCalledWith("storefront shell: link targets unavailable", {
      tenantId: T,
      error: "catalogue down",
    });
  });

  it("policy links: the set ones when showPolicyLinks, none when off; preview uses the draft's handles", async () => {
    const h = harness();
    await h.controller.updatePolicy({
      tenantId: T,
      type: "privacy",
      by: "s",
      expectedVersion: 0,
      body: { ar: "نص" },
    });
    expect(((await h.controller.shell({ tenantId: T })).body as Doc).footer.policies).toEqual([
      "privacy",
    ]);
    await h.controller.createMenu({ tenantId: T, handle: "alt", title: "Alt", items: [] });
    const draft = {
      ...DEFAULT_THEME_DOCUMENT,
      header: { ...DEFAULT_THEME_DOCUMENT.header, menuHandle: "alt" },
      footer: { ...DEFAULT_THEME_DOCUMENT.footer, showPolicyLinks: false },
    };
    await h.controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    const token = (
      (await h.controller.issuePreviewToken({ tenantId: T, createdBy: "s" })).body as {
        token: string;
      }
    ).token;
    const preview = (await h.controller.shell({ tenantId: T, previewToken: token })).body as Doc;
    expect(preview.header.menu).toEqual([]);
    expect(preview.footer.policies).toEqual([]);
    expect(((await h.controller.shell({ tenantId: T })).body as Doc).header.menu).toHaveLength(2);
  });

  it("a Part 1 published document still renders the default menus (Review Focus 3)", async () => {
    const h = harness();
    const partOne = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    partOne.header = { sticky: true };
    partOne.footer = { note: {}, showSocial: true };
    await h.controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: partOne });
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "s" });
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.header).toMatchObject({ sticky: true });
    expect(body.header.menu).toHaveLength(2);
  });

  it("a handle with no saved menu that is not a default serves an empty menu", async () => {
    const h = harness();
    await h.controller.createMenu({ tenantId: T, handle: "alt", title: "Alt", items: [] });
    const doc = {
      ...DEFAULT_THEME_DOCUMENT,
      footer: { ...DEFAULT_THEME_DOCUMENT.footer, menuHandle: "alt" },
    };
    await h.controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc });
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "s" });
    await h.repos.menus.remove("alt", T, undefined);
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.footer.menu).toEqual([]);
    expect(body.header.menu).toHaveLength(2);
  });

  it("link ids that name Object.prototype members never become links (preflight 12)", async () => {
    const h = harness({ targets: TARGETS });
    await h.controller.updateMenu({
      tenantId: T,
      handle: "main-menu",
      title: "Main",
      expectedVersion: 0,
      items: [
        {
          id: ID(1),
          label: { en: "P" },
          link: { type: "collection", id: "__proto__" },
          children: [],
        },
        {
          id: ID(2),
          label: { en: "C" },
          link: { type: "product", id: "constructor" },
          children: [],
        },
        { id: ID(3), label: { en: "S" }, link: { type: "collection", id: "c-1" }, children: [] },
      ],
    });
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.header.menu).toEqual([
      { label: { en: "S" }, href: "/collections/sale", external: false, children: [] },
    ]);
  });

  it("a target whose href is not a safe link is dropped (Task 1's canonical safe href)", async () => {
    const h = harness({
      targets: {
        [T]: {
          collection: {
            "c-bad": { href: "//evil.example/x", title: "Bad", published: true },
            "c-js": { href: "javascript:alert(1)", title: "Js", published: true },
          },
        },
      },
    });
    await h.controller.updateMenu({
      tenantId: T,
      handle: "main-menu",
      title: "Main",
      expectedVersion: 0,
      items: [
        { id: ID(1), label: { en: "B" }, link: { type: "collection", id: "c-bad" }, children: [] },
        { id: ID(2), label: { en: "J" }, link: { type: "collection", id: "c-js" }, children: [] },
      ],
    });
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.header.menu).toEqual([]);
  });
});

describe("the shell's announcement bar (spec 3.2, Ruling 25)", () => {
  const BAR_ID = "00000000-0000-4000-8000-000000000a01";
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const TARGETS = {
    [T]: {
      collection: { "c-1": { href: "/collections/sale", title: "Sale", published: true } },
      page: { "g-1": { href: "/pages/about", title: "About", published: true } },
    },
  };
  const withBar = (bar: unknown) =>
    JSON.parse(
      JSON.stringify({
        ...DEFAULT_THEME_DOCUMENT,
        header: { ...DEFAULT_THEME_DOCUMENT.header, announcement: bar },
      }),
    );
  const bar = (settings: Record<string, unknown>, hidden = false) => ({
    id: BAR_ID,
    type: "announcement_bar",
    hidden,
    settings: { text: { ar: "شحن مجاني" }, link: null, style: "accent", ...settings },
  });
  const tokenOf = async (h: ReturnType<typeof harness>) =>
    (
      (await h.controller.issuePreviewToken({ tenantId: T, createdBy: "s" })).body as {
        token: string;
      }
    ).token;

  beforeEach(() => {
    expect.hasAssertions();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is resolved, and its link joins the menus' single targets call", async () => {
    const h = harness({ targets: TARGETS });
    await h.controller.updateMenu({
      tenantId: T,
      handle: "main-menu",
      title: "Main",
      expectedVersion: 0,
      items: [
        { id: ID(1), label: { en: "Sale" }, link: { type: "collection", id: "c-1" }, children: [] },
      ],
    });
    await h.save(withBar(bar({ link: { type: "page", id: "g-1" }, style: "dark" })), 0);
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    h.resolveCalls.splice(0);
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.header.announcement).toEqual({
      id: BAR_ID,
      type: "announcement_bar",
      settings: {
        text: { ar: "شحن مجاني" },
        link: { href: "/pages/about", external: false },
        style: "dark",
      },
    });
    expect(body.header.menu).toEqual([
      { label: { en: "Sale" }, href: "/collections/sale", external: false, children: [] },
    ]);
    expect(h.resolveCalls).toEqual([2]); // c-1 and g-1, one call
  });

  it("a policy link uses the menus' set policies; a broken link leaves the text", async () => {
    const h = harness({ targets: TARGETS });
    await h.controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "s",
      expectedVersion: 0,
      body: { en: "x" },
    });
    await h.save(withBar(bar({ link: { type: "policy", policy: "refund" } })), 0);
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    expect(
      ((await h.controller.shell({ tenantId: T })).body as Doc).header.announcement,
    ).toMatchObject({
      settings: { link: { href: "/policies/refund-policy", external: false } },
    });
    // A page deleted after it was linked: the bar keeps its text and loses its link.
    const gone = harness({ targets: TARGETS });
    gone.deleteTarget("page", "g-1");
    await gone.seedThemeRow({
      draft: DEFAULT_THEME_DOCUMENT,
      published: withBar(bar({ link: { type: "page", id: "g-1" } })),
      version: 1,
    });
    expect(
      ((await gone.controller.shell({ tenantId: T })).body as Doc).header.announcement,
    ).toEqual({
      id: BAR_ID,
      type: "announcement_bar",
      settings: { text: { ar: "شحن مجاني" }, link: null, style: "accent" },
    });
  });

  it("a hidden bar is null live and flagged hidden in preview", async () => {
    const h = harness();
    await h.save(withBar(bar({}, true)), 0);
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    expect(
      ((await h.controller.shell({ tenantId: T })).body as Doc).header.announcement,
    ).toBeNull();
    const token = await tokenOf(h);
    const preview = (await h.controller.shell({ tenantId: T, previewToken: token })).body as Doc;
    expect(preview.header.announcement).toEqual({
      id: BAR_ID,
      type: "announcement_bar",
      hidden: true,
      settings: { text: { ar: "شحن مجاني" }, link: null, style: "accent" },
    });
  });

  it("a draft bar shows only in preview; no bar is null", async () => {
    const h = harness();
    expect(
      ((await h.controller.shell({ tenantId: T })).body as Doc).header.announcement,
    ).toBeNull();
    await h.save(withBar(bar({})), 0);
    expect(
      ((await h.controller.shell({ tenantId: T })).body as Doc).header.announcement,
    ).toBeNull();
    const token = await tokenOf(h);
    const preview = (await h.controller.shell({ tenantId: T, previewToken: token })).body as Doc;
    expect(preview.header.announcement).toMatchObject({ id: BAR_ID, hidden: false });
  });

  it("a bar without text is null live and in preview: the header has no placeholder", async () => {
    const h = harness();
    const empty = withBar(bar({ text: {} }));
    await h.seedThemeRow({ draft: empty, published: empty, version: 1 });
    expect(
      ((await h.controller.shell({ tenantId: T })).body as Doc).header.announcement,
    ).toBeNull();
    const token = await tokenOf(h);
    const preview = (await h.controller.shell({ tenantId: T, previewToken: token })).body as Doc;
    expect(preview.header.announcement).toBeNull();
  });

  it("a hidden bar's link is not looked up live", async () => {
    const h = harness({ targets: TARGETS });
    await h.save(withBar(bar({ link: { type: "page", id: "g-1" } }, true)), 0);
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    h.resolveCalls.splice(0);
    await h.controller.shell({ tenantId: T });
    expect(h.resolveCalls).toEqual([]);
  });
});
