import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HOMEPAGE_SECTION_IDS,
  DEFAULT_THEME_DOCUMENT,
  newSection,
  type KnownSection,
  type Section,
  type SettingsByType,
} from "@platform/storefront-content";
import { logger } from "@platform/utils";
import { harness, HARNESS_TENANT as T } from "../testing/fakes";

type Body = { mode: string; sections: Record<string, unknown>[] };

let n = 0;
const nextId = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;

function section<K extends KnownSection["type"]>(
  type: K,
  over: Partial<SettingsByType[K]> = {},
  hidden = false,
): Extract<KnownSection, { type: K }> {
  const base = newSection(type, nextId());
  return { ...base, hidden, settings: { ...base.settings, ...over } } as Extract<
    KnownSection,
    { type: K }
  >;
}

const docWith = (sections: readonly Section[]) =>
  JSON.parse(JSON.stringify({ ...DEFAULT_THEME_DOCUMENT, homepage: { sections } }));

const collection = (title: string, slug: string) => ({
  href: `/collections/${slug}`,
  title,
  published: true,
  slug,
});

const TARGETS = {
  [T]: {
    collection: { c1: collection("Sale", "sale") },
    product: { p1: { href: "/products/mug", title: "Mug", published: true, slug: "mug" } },
    page: { pg1: { href: "/pages/about", title: "About", published: true } },
  },
};

async function tokenOf(h: ReturnType<typeof harness>): Promise<string> {
  const res = await h.controller.issuePreviewToken({ tenantId: T, createdBy: "s" });
  return (res.body as { token: string }).token;
}

describe("GetStorefrontHome (spec 3.4, Ruling 13)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a shop with no theme row serves the default sections resolved, live, with no reads", async () => {
    const h = harness();
    const res = await h.controller.home({ tenantId: T });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      mode: "live",
      sections: [
        {
          id: DEFAULT_HOMEPAGE_SECTION_IDS[0],
          type: "featured_products",
          settings: {
            source: "newest",
            count: 8,
            heading: { ar: "المنتجات", en: "Products" },
            columns: 2,
          },
        },
        {
          id: DEFAULT_HOMEPAGE_SECTION_IDS[1],
          type: "collection_list",
          settings: { source: "all", heading: { ar: "المجموعات", en: "Collections" }, columns: 2 },
        },
      ],
    });
    expect(h.resolveCalls).toEqual([]);
    expect(h.imageResolveCalls).toEqual([]);
  });

  it("serves the published document live; the draft only with a valid preview token", async () => {
    const h = harness();
    const published = section("rich_text", { heading: { en: "Published" } });
    const draftVisible = section("rich_text", { heading: { en: "Draft" } });
    const draftHidden = section("rich_text", { heading: { en: "Hidden" } }, true);
    expect((await h.save(docWith([published]), 0)).status).toBe(200);
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    const { version } = (await h.controller.getTheme({ tenantId: T })).body as { version: number };
    expect((await h.save(docWith([draftVisible, draftHidden]), version)).status).toBe(200);

    const live = (await h.controller.home({ tenantId: T })).body as Body;
    expect(live.mode).toBe("live");
    expect(live.sections.map((s) => s.id)).toEqual([published.id]);
    expect(live.sections[0]).not.toHaveProperty("hidden");
    expect(JSON.stringify(live)).not.toMatch(/Draft|Hidden/);

    const token = await tokenOf(h);
    const preview = await h.controller.home({ tenantId: T, previewToken: token });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      mode: "preview",
      sections: [
        { id: draftVisible.id, hidden: false, settings: { heading: { en: "Draft" } } },
        { id: draftHidden.id, hidden: true, settings: { heading: { en: "Hidden" } } },
      ],
    });
    expect(JSON.stringify(preview.body)).not.toContain(token);
  });

  it("a draft that was never published is not live: live serves the default sections", async () => {
    const h = harness();
    await h.save(docWith([section("rich_text", { heading: { en: "Draft" } })]), 0);
    const live = (await h.controller.home({ tenantId: T })).body as Body;
    expect(live.sections.map((s) => s.id)).toEqual([...DEFAULT_HOMEPAGE_SECTION_IDS]);
  });

  it("an invalid, foreign or expired token is preview_invalid and serves nothing", async () => {
    const h = harness();
    await h.save(docWith([section("rich_text", { heading: { en: "Secret draft" } })]), 0);
    const token = await tokenOf(h);
    const answers = [
      await h.controller.home({ tenantId: T, previewToken: "a".repeat(43) }),
      await h.controller.home({ tenantId: T, previewToken: "" }),
      await h.controller.home({ tenantId: "t-2", previewToken: token }),
    ];
    h.advance(24 * 60 * 60 * 1000 + 1);
    answers.push(await h.controller.home({ tenantId: T, previewToken: token }));
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "PREVIEW_INVALID" });
      expect(JSON.stringify(res.body)).not.toMatch(/Secret|sections/);
    }
  });

  it("live loads only visible sections; preview loads every section", async () => {
    const h = harness({ owned: { [T]: ["m1", "m9"] } });
    const shown = section("hero", { image: "m1" });
    const hidden = section("hero", { image: "m9" }, true);
    await h.seedThemeRow({
      draft: docWith([shown, hidden]),
      published: docWith([shown, hidden]),
      version: 1,
    });

    const live = (await h.controller.home({ tenantId: T })).body as Body;
    expect(live.sections.map((s) => s.id)).toEqual([shown.id]);
    expect(h.imageResolveCalls).toEqual([{ ids: ["m1"], tenantId: T }]);

    h.imageResolveCalls.splice(0);
    const token = await tokenOf(h);
    const preview = (await h.controller.home({ tenantId: T, previewToken: token })).body as Body;
    expect(preview.sections.map((s) => s.id)).toEqual([shown.id, hidden.id]);
    expect(h.imageResolveCalls).toEqual([{ ids: ["m1", "m9"], tenantId: T }]);
  });

  it("one link-target resolve and one image read for the whole page, with the request's tenant", async () => {
    const h = harness({ owned: { [T]: ["m1", "m2"] }, targets: TARGETS });
    await h.seedThemeRow({
      draft: DEFAULT_THEME_DOCUMENT,
      published: docWith([
        section("hero", { image: "m1", buttonLink: { type: "collection", id: "c1" } }),
        section("featured_collection", { collection: "c1" }),
        section("featured_products", { source: "manual", products: ["p1", "gone"] }),
        section("collection_list", {
          source: "manual",
          items: [{ collection: "c1", image: "m2" }],
        }),
        section("rich_text", {
          buttonLabel: { en: "About" },
          buttonLink: { type: "page", id: "pg1" },
        }),
        section("image_with_text", { image: "m2" }),
      ]),
      version: 1,
    });
    const body = (await h.controller.home({ tenantId: T })).body as Body;
    expect(body.sections).toHaveLength(6);
    expect(h.resolveCalls).toEqual([4]); // c1, p1, gone, pg1
    expect(h.imageResolveCalls).toEqual([{ ids: ["m1", "m2"], tenantId: T }]);
    expect(body.sections[2]).toMatchObject({ settings: { productIds: ["p1"] } });
  });

  it("each of images, targets and policies failing degrades only what needs it; still ok", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const options = {
      owned: { [T]: ["m1"] },
      targets: TARGETS,
      imageResolveFails: false,
      linkTargetsFail: false,
    };
    const h = harness(options);
    await h.controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "s",
      expectedVersion: 0,
      body: { en: "x" },
    });
    const heroSection = section("hero", {
      image: "m1",
      buttonLabel: { en: "Refunds" },
      buttonLink: { type: "policy", policy: "refund" },
    });
    const featured = section("featured_collection", { collection: "c1" });
    const about = section("rich_text", {
      heading: { en: "About" },
      buttonLabel: { en: "Read" },
      buttonLink: { type: "page", id: "pg1" },
    });
    await h.seedThemeRow({
      draft: DEFAULT_THEME_DOCUMENT,
      published: docWith([heroSection, featured, about]),
      version: 1,
    });
    const read = async () => {
      const res = await h.controller.home({ tenantId: T });
      expect(res.status).toBe(200);
      return res.body as Body;
    };

    const healthy = await read();
    expect(healthy.sections).toMatchObject([
      {
        settings: {
          image: { url: "https://cdn.test/m1.png" },
          button: { link: { href: "/policies/refund-policy" } },
        },
      },
      { settings: { collection: { id: "c1" } } },
      { settings: { button: { link: { href: "/pages/about" } } } },
    ]);
    expect(warn).not.toHaveBeenCalled();

    options.imageResolveFails = true;
    expect(await read()).toEqual({
      mode: "live",
      sections: [
        {
          ...healthy.sections[0],
          settings: { ...(healthy.sections[0]?.settings as object), image: null },
        },
        healthy.sections[1],
        healthy.sections[2],
      ],
    });
    options.imageResolveFails = false;

    options.linkTargetsFail = true;
    const noTargets = await read();
    // The featured collection drops; the page button goes; the policy button stays.
    expect(noTargets.sections).toMatchObject([
      { id: heroSection.id, settings: { button: { link: { href: "/policies/refund-policy" } } } },
      { id: about.id, settings: { button: null } },
    ]);
    options.linkTargetsFail = false;

    vi.spyOn(h.repos.policies, "list").mockRejectedValue(new Error("db down"));
    const noPolicies = await read();
    expect(noPolicies.sections).toMatchObject([
      { id: heroSection.id, settings: { image: { url: "https://cdn.test/m1.png" }, button: null } },
      { id: featured.id, settings: { collection: { id: "c1" } } },
      { id: about.id, settings: { button: { link: { href: "/pages/about" } } } },
    ]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      "storefront home: images unavailable",
      "storefront home: link targets unavailable",
      "storefront home: policies unavailable",
    ]);
  });

  it("serves no tenant, image ref, removed id or unknown-type content (leak test)", async () => {
    const h = harness({ owned: { [T]: ["m1"] }, targets: TARGETS });
    const future = {
      id: nextId(),
      type: "countdown_timer",
      hidden: false,
      settings: { secret: "UNKNOWN-CONTENT", image: "m1", collection: "c1" },
    };
    await h.seedThemeRow({
      draft: DEFAULT_THEME_DOCUMENT,
      published: docWith([
        section("hero", { image: "m1", mobileImage: "gone-image" }),
        section("featured_collection", { collection: "gone-collection" }),
        section("featured_products", { source: "manual", products: ["gone-product", "p1"] }),
        section("collection_list", {
          source: "manual",
          items: [
            { collection: "gone-collection", image: "m1" },
            { collection: "c1", image: "gone-image" },
          ],
        }),
        future as unknown as Section,
      ]),
      version: 1,
    });
    const res = await h.controller.home({ tenantId: T });
    const json = JSON.stringify(res.body);
    expect((res.body as Body).sections.map((s) => s.type)).toEqual([
      "hero",
      "featured_products",
      "collection_list",
    ]);
    expect(json).not.toMatch(
      /"m1"|gone|tenant|t-1|imageRef|storageKey|countdown_timer|UNKNOWN-CONTENT|secret/,
    );
    // The unknown section's refs were never even looked up.
    expect(h.imageResolveCalls).toEqual([{ ids: ["m1", "gone-image"], tenantId: T }]);
  });
});
