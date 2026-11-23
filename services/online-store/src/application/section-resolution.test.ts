import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newSection,
  type KnownSection,
  type LinkRef,
  type Section,
  type SettingsByType,
  type UnsupportedSection,
} from "@platform/storefront-content";
import { logger } from "@platform/utils";
import { fakeImageRefs, fakeLinkTargets } from "../testing/fakes";
import type { OnlineStoreDeps } from "./deps";
import { emptyTargets } from "./menu-resolution";
import type { CatalogLinkType, ImageDto, LinkTarget, LinkTargetMap } from "./ports";
import {
  loadResolutionContext,
  resolutionInputsOf,
  resolveSection,
  resolveSections,
  type ResolutionContext,
} from "./section-resolution";

const T = "t-1";
const IMG: ImageDto = {
  url: "https://cdn.test/media/one.png",
  alt: "Mug",
  width: 800,
  height: 600,
};
const MOBILE: ImageDto = {
  url: "https://cdn.test/media/two.png",
  alt: null,
  width: 400,
  height: 800,
};

let n = 0;
const nextId = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;

/** A collection or product target as the adapter builds it. */
const t = (title: string, slug: string, published: boolean): LinkTarget => ({
  href: `/collections/${slug}`,
  title,
  published,
  slug,
});

/** A null-prototype map, as `emptyTargets()` and the adapter build. */
function targets(
  entries: Partial<Record<CatalogLinkType, Record<string, LinkTarget>>>,
): LinkTargetMap {
  const map = emptyTargets() as Record<CatalogLinkType, Record<string, LinkTarget>>;
  for (const kind of ["collection", "product", "page"] as const) {
    Object.assign(map[kind], entries[kind] ?? {});
  }
  return map;
}

function section<K extends KnownSection["type"]>(
  type: K,
  over: Partial<SettingsByType[K]> = {},
): Extract<KnownSection, { type: K }> {
  const base = newSection(type, nextId());
  return { ...base, settings: { ...base.settings, ...over } } as Extract<KnownSection, { type: K }>;
}

const fc = (collection: string | null) => section("featured_collection", { collection });
const products = (source: "newest" | "manual", ids: string[]) =>
  section("featured_products", { source, products: ids });
const hero = (over: Partial<SettingsByType["hero"]> = {}) => section("hero", over);
const bar = (link: LinkRef | null, over: Partial<SettingsByType["announcement_bar"]> = {}) =>
  section("announcement_bar", { link, ...over });
const rich = (over: Partial<SettingsByType["rich_text"]> = {}) => section("rich_text", over);
const imageText = (over: Partial<SettingsByType["image_with_text"]> = {}) =>
  section("image_with_text", over);
const list = (source: "all" | "manual", items: SettingsByType["collection_list"]["items"]) =>
  section("collection_list", { source, items });
const whatsapp = (phone: string) => section("whatsapp_cta", { phone });
const leadForm = (over: Partial<SettingsByType["lead_form"]> = {}) => section("lead_form", over);
const UNSUPPORTED: UnsupportedSection = {
  id: "00000000-0000-4000-8000-000000000999",
  type: "countdown_timer",
  hidden: false,
  settings: { endsAt: "2027-01-01", secret: "UNKNOWN-CONTENT", image: "m1" },
};

const ctx = (over: Partial<ResolutionContext> = {}): ResolutionContext => ({
  images: { m1: IMG, m2: MOBILE },
  targets: targets({
    collection: { c1: t("Sale", "sale", true), c2: t("Old", "old", false) },
    product: { p1: t("Mug", "mug", true), p2: t("Cup", "cup", true), p3: t("Hat", "hat", false) },
    page: { pg1: { href: "/pages/about", title: "About", published: true } },
  }),
  setPolicies: new Set(["refund"]),
  ...over,
});

describe("resolveSection (spec 3.4, Ruling 13)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("a featured collection carries { id, slug, name }; without a live collection it is dropped", () => {
    expect(resolveSection(fc("c1"), ctx(), "live")).toMatchObject({
      settings: { collection: { id: "c1", slug: "sale", name: "Sale" } },
    });
    for (const id of [null, "c2", "gone"]) expect(resolveSection(fc(id), ctx(), "live")).toBeNull();
  });

  it("a collection target with no slug, or an empty one, is not a live collection", () => {
    const noSlug = targets({
      collection: { c1: { href: "/collections/x", title: "X", published: true } },
    });
    const emptySlug = targets({ collection: { c1: t("X", "", true) } });
    for (const map of [noSlug, emptySlug]) {
      expect(resolveSection(fc("c1"), ctx({ targets: map }), "live")).toBeNull();
    }
  });

  it("the collection reference carries exactly id, slug and name (no href, no published)", () => {
    const out = resolveSection(fc("c1"), ctx(), "live");
    expect(out).toEqual({
      id: expect.any(String),
      type: "featured_collection",
      settings: {
        collection: { id: "c1", slug: "sale", name: "Sale" },
        heading: { ar: "مجموعة مميزة", en: "Featured collection" },
        productCount: 8,
        columns: 4,
        showViewAll: true,
      },
    });
  });

  it("manual products keep the live ids in order; none left drops the section; newest always stays", () => {
    expect(resolveSection(products("manual", ["gone", "p1"]), ctx(), "live")).toMatchObject({
      settings: { source: "manual", productIds: ["p1"] },
    });
    expect(resolveSection(products("manual", ["gone"]), ctx(), "live")).toBeNull();
    expect(resolveSection(products("newest", []), ctx(), "live")).toMatchObject({
      settings: { source: "newest", count: 8 },
    });
  });

  it("manual products: unpublished dropped, duplicates collapsed case-sensitively, order kept", () => {
    const map = targets({
      product: {
        p1: t("Mug", "mug", true),
        P1: t("Big mug", "big-mug", true),
        p2: t("Cup", "cup", true),
        p3: t("Hat", "hat", false),
      },
    });
    const out = resolveSection(
      products("manual", ["p2", "p3", "p1", "P1", "p2", "p1"]),
      ctx({ targets: map }),
      "live",
    );
    expect(out).toMatchObject({ settings: { productIds: ["p2", "p1", "P1"] } });
    expect(resolveSection(products("manual", []), ctx(), "live")).toBeNull();
    expect(resolveSection(products("newest", ["p1"]), ctx(), "live")).not.toHaveProperty(
      "settings.productIds",
    );
  });

  it("a hero drops a broken image and a button without a link; empty of everything it is dropped", () => {
    const out = resolveSection(
      hero({ image: "gone", buttonLink: { type: "collection", id: "gone" } }),
      ctx(),
      "live",
    );
    expect(out).toMatchObject({ settings: { image: null, button: null } });
    expect(
      resolveSection(
        hero({ image: null, heading: {}, subheading: {}, buttonLabel: {} }),
        ctx(),
        "live",
      ),
    ).toBeNull();
  });

  it("a hero resolves its mobile image on its own; a broken one is null; alone it keeps nothing", () => {
    expect(resolveSection(hero({ image: "m1", mobileImage: "m2" }), ctx(), "live")).toMatchObject({
      settings: { image: IMG, mobileImage: MOBILE },
    });
    expect(resolveSection(hero({ image: "m1", mobileImage: "gone" }), ctx(), "live")).toMatchObject(
      {
        settings: { image: IMG, mobileImage: null },
      },
    );
    // The renderer draws the picture from the desktop image; a mobile image alone shows nothing.
    const mobileOnly = hero({
      image: null,
      mobileImage: "m2",
      heading: {},
      subheading: {},
      buttonLabel: {},
    });
    expect(resolveSection(mobileOnly, ctx(), "live")).toBeNull();
  });

  it("a hero button needs a label in either locale and a live link", () => {
    const withButton = resolveSection(
      hero({ buttonLabel: { en: "Shop" }, buttonLink: { type: "collection", id: "c1" } }),
      ctx(),
      "live",
    );
    expect(withButton).toMatchObject({
      settings: {
        button: { label: { en: "Shop" }, link: { href: "/collections/sale", external: false } },
      },
    });
    expect(
      resolveSection(hero({ buttonLabel: {}, buttonLink: { type: "home" } }), ctx(), "live"),
    ).toMatchObject({ settings: { button: null } });
    expect(
      resolveSection(hero({ buttonLabel: { ar: "تسوق" }, buttonLink: null }), ctx(), "live"),
    ).toMatchObject({ settings: { button: null } });
  });

  it("links resolve to canonical safe hrefs: page, policy (only when set), url, home", () => {
    expect(resolveSection(bar({ type: "page", id: "pg1" }), ctx(), "live")).toMatchObject({
      settings: { link: { href: "/pages/about", external: false } },
    });
    expect(resolveSection(bar({ type: "policy", policy: "privacy" }), ctx(), "live")).toMatchObject(
      {
        settings: { link: null },
      },
    );
    expect(resolveSection(bar({ type: "policy", policy: "refund" }), ctx(), "live")).toMatchObject({
      settings: { link: { href: "/policies/refund-policy", external: false } },
    });
    expect(
      resolveSection(bar({ type: "url", url: "https://wa.me/20100" }), ctx(), "live"),
    ).toMatchObject({ settings: { link: { href: "https://wa.me/20100", external: true } } });
    expect(resolveSection(bar({ type: "home" }), ctx(), "live")).toMatchObject({
      settings: { link: { href: "/", external: false } },
    });
  });

  it("a link to an unpublished, unknown, inherited or unsafe target is dropped", () => {
    const map = targets({
      collection: {
        c2: t("Old", "old", false),
        bad: { href: "//evil.example/x", title: "B", published: true },
      },
    });
    for (const link of [
      { type: "collection", id: "c2" },
      { type: "collection", id: "gone" },
      { type: "collection", id: "bad" },
      { type: "product", id: "constructor" },
      { type: "page", id: "__proto__" },
    ] as LinkRef[]) {
      expect(
        resolveSection(bar(link), ctx({ targets: map }), "live"),
        JSON.stringify(link),
      ).toMatchObject({
        settings: { link: null },
      });
    }
  });

  it("an announcement bar without text is dropped; with text it keeps its style", () => {
    expect(resolveSection(bar(null, { text: {} }), ctx(), "live")).toBeNull();
    expect(
      resolveSection(bar(null, { text: { en: "Sale" }, style: "dark" }), ctx(), "live"),
    ).toEqual({
      id: expect.any(String),
      type: "announcement_bar",
      settings: { text: { en: "Sale" }, link: null, style: "dark" },
    });
  });

  it("WhatsApp needs valid digits; testimonials and features keep only items with text", () => {
    expect(resolveSection(whatsapp("201001234567"), ctx(), "live")).toMatchObject({
      settings: {
        phone: "201001234567",
        message: { en: "Hello, I have a question about a product." },
      },
    });
    for (const phone of [
      "",
      "0100123",
      "01001234567",
      "1234567",
      "2010012345678901",
      "20abc12345",
    ]) {
      expect(resolveSection(whatsapp(phone), ctx(), "live"), phone).toBeNull();
    }

    const quotes = section("testimonials", {
      items: [
        { quote: {}, author: "Nobody", rating: 5 },
        { quote: { ar: "رائع" }, author: "Mona", rating: 4 },
      ],
    });
    expect(resolveSection(quotes, ctx(), "live")).toMatchObject({
      settings: { items: [{ quote: { ar: "رائع" }, author: "Mona", rating: 4 }] },
    });
    expect(
      resolveSection(
        section("testimonials", { items: [{ quote: {}, author: "A", rating: 3 }] }),
        ctx(),
        "live",
      ),
    ).toBeNull();

    const perks = section("features", {
      items: [
        { icon: "cod", title: {}, text: {} },
        { icon: "gift", title: {}, text: { en: "Wrapped" } },
        { icon: "shipping", title: { ar: "شحن" }, text: {} },
      ],
    });
    expect(resolveSection(perks, ctx(), "live")).toMatchObject({
      settings: {
        items: [
          { icon: "gift", title: {}, text: { en: "Wrapped" } },
          { icon: "shipping", title: { ar: "شحن" }, text: {} },
        ],
      },
    });
    expect(
      resolveSection(
        section("features", { items: [{ icon: "cod", title: {}, text: {} }] }),
        ctx(),
        "live",
      ),
    ).toBeNull();
  });

  it("collection_list manual: items without a live collection go, each image resolves, none left drops it", () => {
    const out = resolveSection(
      list("manual", [
        { collection: "gone", image: "m1" },
        { collection: "c1", image: "m1" },
        { collection: "c2", image: null },
        { collection: null, image: "m2" },
        { collection: "c1", image: "gone" },
      ]),
      ctx(),
      "live",
    );
    expect(out).toMatchObject({
      settings: {
        source: "manual",
        items: [
          { collection: { id: "c1", slug: "sale", name: "Sale" }, image: IMG },
          { collection: { id: "c1", slug: "sale", name: "Sale" }, image: null },
        ],
      },
    });
    expect(
      resolveSection(
        list("manual", [
          { collection: "gone", image: "m1" },
          { collection: null, image: null },
        ]),
        ctx(),
        "live",
      ),
    ).toBeNull();
    expect(resolveSection(list("manual", []), ctx(), "live")).toBeNull();
    expect(resolveSection(list("all", []), ctx(), "live")).toMatchObject({
      settings: { source: "all", columns: 3 },
    });
    expect(
      resolveSection(list("all", [{ collection: "c1", image: "m1" }]), ctx(), "live"),
    ).not.toHaveProperty("settings.items");
  });

  it("image_with_text: kept by an image, a heading, a body or a button; dropped with none", () => {
    const empty = { image: null, heading: {}, body: {}, buttonLabel: {}, buttonLink: null };
    expect(resolveSection(imageText(empty), ctx(), "live")).toBeNull();
    expect(resolveSection(imageText({ ...empty, image: "gone" }), ctx(), "live")).toBeNull();
    expect(resolveSection(imageText({ ...empty, image: "m1" }), ctx(), "live")).toMatchObject({
      settings: { image: IMG },
    });
    expect(
      resolveSection(imageText({ ...empty, heading: { en: "Hi" } }), ctx(), "live"),
    ).not.toBeNull();
    expect(
      resolveSection(imageText({ ...empty, body: { ar: "نص" } }), ctx(), "live"),
    ).not.toBeNull();
    expect(
      resolveSection(
        imageText({ ...empty, buttonLabel: { en: "Go" }, buttonLink: { type: "home" } }),
        ctx(),
        "live",
      ),
    ).toMatchObject({ settings: { button: { label: { en: "Go" }, link: { href: "/" } } } });
    // A label whose link is broken is no button, so it does not keep the section either.
    expect(
      resolveSection(
        imageText({
          ...empty,
          buttonLabel: { en: "Go" },
          buttonLink: { type: "page", id: "gone" },
        }),
        ctx(),
        "live",
      ),
    ).toBeNull();
  });

  it("rich_text: kept by a heading, a body or a button; dropped with none", () => {
    const empty = { heading: {}, body: {}, buttonLabel: {}, buttonLink: null };
    expect(resolveSection(rich(empty), ctx(), "live")).toBeNull();
    expect(
      resolveSection(rich({ ...empty, heading: { ar: "عنّا" } }), ctx(), "live"),
    ).toMatchObject({
      settings: { heading: { ar: "عنّا" }, body: {}, button: null, align: "center" },
    });
    expect(resolveSection(rich({ ...empty, body: { en: "Story" } }), ctx(), "live")).not.toBeNull();
    expect(
      resolveSection(
        rich({ ...empty, buttonLabel: { en: "Read" }, buttonLink: { type: "page", id: "pg1" } }),
        ctx(),
        "live",
      ),
    ).toMatchObject({ settings: { button: { link: { href: "/pages/about" } } } });
  });

  it("a lead form is always complete and carries exactly its six settings", () => {
    const expected = {
      id: expect.any(String),
      type: "lead_form",
      settings: {
        heading: { ar: "اطلب استشارة", en: "Get in touch" },
        text: {
          ar: "سيب بياناتك وهنكلمك في أقرب وقت",
          en: "Leave your details and we will call you back",
        },
        submitLabel: { ar: "ابعت", en: "Send" },
        successMessage: {
          ar: "وصلتنا بياناتك، هنتواصل معاك قريب",
          en: "Thanks! We will contact you soon",
        },
        showEmail: true,
        showMessage: true,
      },
    };
    expect(resolveSection(leadForm(), ctx(), "live")).toEqual(expected);
    expect(resolveSection(leadForm(), ctx(), "preview")).toEqual({ ...expected, hidden: false });
  });

  it("a lead form keeps showEmail/showMessage false as false", () => {
    expect(
      resolveSection(leadForm({ showEmail: false, showMessage: false }), ctx(), "live"),
    ).toMatchObject({ settings: { showEmail: false, showMessage: false } });
    expect(resolveSection(leadForm({ showEmail: false }), ctx(), "live")).toMatchObject({
      settings: { showEmail: false, showMessage: true },
    });
  });

  it("a lead form with a missing or non-boolean flag reads it as true", () => {
    const base = leadForm();
    const { showEmail: _email, ...rest } = base.settings;
    const odd = { ...base, settings: { ...rest, showMessage: "no" } } as unknown as Section;
    expect(resolveSection(odd, ctx(), "live")).toMatchObject({
      settings: { showEmail: true, showMessage: true },
    });
  });

  it("hidden: omitted live, flagged in preview; unknown types are never served", () => {
    const h = { ...rich(), hidden: true };
    expect(resolveSection(h, ctx(), "live")).toBeNull();
    expect(resolveSection(h, ctx(), "preview")).toMatchObject({ hidden: true });
    expect(resolveSection(rich(), ctx(), "live")).not.toHaveProperty("hidden");
    expect(resolveSection(UNSUPPORTED, ctx(), "preview")).toBeNull();
    expect(resolveSection(UNSUPPORTED, ctx(), "live")).toBeNull();
  });

  it("preview: a section the live rules drop is an incomplete placeholder; live drops it (F2)", () => {
    const cases: Section[] = [
      fc(null),
      fc("gone"),
      products("manual", []),
      products("manual", ["gone"]),
      whatsapp(""),
      list("manual", []),
      hero({ image: null, heading: {}, subheading: {}, buttonLabel: {} }),
      rich({ heading: {}, body: {}, buttonLabel: {}, buttonLink: null }),
      section("testimonials", { items: [{ quote: {}, author: "", rating: 0 }] }),
    ];
    for (const s of cases) {
      expect(resolveSection(s, ctx(), "live"), s.type).toBeNull();
      expect(resolveSection(s, ctx(), "preview"), s.type).toEqual({
        id: s.id,
        type: s.type,
        hidden: false,
        incomplete: true,
      });
    }
    const hiddenIncomplete = { ...fc(null), hidden: true };
    expect(resolveSection(hiddenIncomplete, ctx(), "preview")).toEqual({
      id: hiddenIncomplete.id,
      type: "featured_collection",
      hidden: true,
      incomplete: true,
    });
    expect(resolveSection(hiddenIncomplete, ctx(), "live")).toBeNull();
  });

  it("a complete section in preview carries its settings and no incomplete flag", () => {
    const out = resolveSection(fc("c1"), ctx(), "preview");
    expect(out).toMatchObject({ hidden: false, settings: { collection: { id: "c1" } } });
    expect(out).not.toHaveProperty("incomplete");
  });

  it("outputs are copies: no stored settings key and no extra image field leaks through", () => {
    const sneaky = {
      ...rich({ heading: { ar: "x" } }),
      settings: { ...rich({ heading: { ar: "x" } }).settings, extra: "LEAK" },
    } as unknown as Section;
    const images = { m1: { ...IMG, storageKey: "tenants/t-1/secret" } as ImageDto };
    const json = JSON.stringify([
      resolveSection(sneaky, ctx(), "live"),
      resolveSection(hero({ image: "m1" }), ctx({ images }), "live"),
    ]);
    expect(json).not.toMatch(/LEAK|storageKey|tenants\//);
  });

  it("an image id naming an Object.prototype member is no image", () => {
    expect(
      resolveSection(hero({ image: "constructor", heading: { en: "x" } }), ctx(), "live"),
    ).toMatchObject({ settings: { image: null } });
    expect(
      resolveSection(hero({ image: "__proto__", heading: { en: "x" } }), ctx(), "live"),
    ).toMatchObject({ settings: { image: null } });
  });

  it("the DTO holds no image ref, no tenant, no removed id (leak test)", () => {
    const json = JSON.stringify(
      resolveSections(
        [
          fc("c1"),
          hero({ image: "m1", mobileImage: "gone" }),
          products("manual", ["p1", "gone"]),
          list("manual", [
            { collection: "gone", image: "m1" },
            { collection: "c1", image: "m2" },
          ]),
          UNSUPPORTED,
        ],
        ctx(),
        "live",
      ),
    );
    expect(json).toContain("c1"); // the collection id is public
    expect(json).not.toMatch(
      /"m1"|"m2"|gone|tenant|imageRef|storageKey|countdown_timer|UNKNOWN-CONTENT/,
    );
  });

  it("resolveSections keeps the order and skips dropped sections", () => {
    const a = rich({ heading: { en: "A" } });
    const b = fc("gone");
    const c = fc("c1");
    expect(resolveSections([a, b, UNSUPPORTED, c], ctx(), "live").map((s) => s.id)).toEqual([
      a.id,
      c.id,
    ]);
    expect(resolveSections([a, b, UNSUPPORTED, c], ctx(), "preview").map((s) => s.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
  });
});

describe("resolutionInputsOf", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("lists distinct image and target ids of known sections, and whether a policy link exists", () => {
    const inputs = resolutionInputsOf([
      hero({ image: "m1", mobileImage: "m2", buttonLink: { type: "collection", id: "c1" } }),
      fc("c1"),
      products("manual", ["p1", "p2", "p1"]),
      list("manual", [{ collection: "c3", image: "m1" }]),
      rich({ buttonLink: { type: "page", id: "pg1" } }),
      UNSUPPORTED,
    ]);
    expect(inputs).toEqual({
      imageIds: ["m1", "m2"],
      targets: { collection: ["c1", "c3"], product: ["p1", "p2"], page: ["pg1"] },
      needsPolicies: false,
    });
    expect(resolutionInputsOf([bar({ type: "policy", policy: "terms" })]).needsPolicies).toBe(true);
    expect(
      resolutionInputsOf([imageText({ buttonLink: { type: "policy", policy: "privacy" } })])
        .needsPolicies,
    ).toBe(true);
  });
});

describe("loadResolutionContext", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const policyList = (types: string[]) =>
    vi.fn(() =>
      Promise.resolve(types.map((type) => ({ isSet: true, snapshot: () => ({ type }) }))),
    );

  function deps(over: Partial<Record<"images" | "targets" | "policies", unknown>> = {}) {
    const calls: number[] = [];
    const imageRefs = fakeImageRefs({ [T]: ["m1"], "t-2": ["m-foreign"] });
    const linkTargets = fakeLinkTargets(
      {
        targets: {
          [T]: { collection: { c1: t("Sale", "sale", true) } },
          "t-2": { collection: { "c-foreign": t("Theirs", "theirs", true) } },
        },
      },
      calls,
    );
    const d = {
      imageRefs: { ...imageRefs, resolve: vi.fn(imageRefs.resolve) },
      linkTargets: { ...linkTargets, resolve: vi.fn(linkTargets.resolve) },
      policies: { list: policyList(["refund"]) },
      ...over,
    };
    return d as unknown as Pick<OnlineStoreDeps, "imageRefs" | "linkTargets" | "policies"> &
      typeof d;
  }

  it("one call per port, each with the request's tenant; nothing to load is no call", async () => {
    const d = deps();
    const sections = [
      hero({ image: "m1", buttonLink: { type: "policy", policy: "refund" } }),
      fc("c1"),
    ];
    const loaded = await loadResolutionContext(d, sections, T);
    expect(d.imageRefs.resolve).toHaveBeenCalledTimes(1);
    expect(d.imageRefs.resolve).toHaveBeenCalledWith(["m1"], T);
    expect(d.linkTargets.resolve).toHaveBeenCalledTimes(1);
    expect(d.linkTargets.resolve).toHaveBeenCalledWith(
      { collection: ["c1"], product: [], page: [] },
      T,
    );
    expect(d.policies.list).toHaveBeenCalledWith(T);
    expect(resolveSections(sections, loaded, "live")).toMatchObject([
      {
        settings: {
          image: { url: "https://cdn.test/m1.png" },
          button: { link: { href: "/policies/refund-policy" } },
        },
      },
      { settings: { collection: { id: "c1" } } },
    ]);

    const none = deps();
    const bare = await loadResolutionContext(
      none,
      [section("features"), products("newest", [])],
      T,
    );
    expect(none.imageRefs.resolve).not.toHaveBeenCalled();
    expect(none.linkTargets.resolve).not.toHaveBeenCalled();
    expect(none.policies.list).not.toHaveBeenCalled();
    expect(bare.images).toEqual({});
    expect([...bare.setPolicies]).toEqual([]);
  });

  it("an image or collection that belongs to another shop resolves to nothing (F26)", async () => {
    const d = deps();
    const sections = [
      hero({ image: "m-foreign", heading: { en: "Hi" } }),
      fc("c-foreign"),
      list("manual", [{ collection: "c-foreign", image: "m-foreign" }]),
    ];
    const loaded = await loadResolutionContext(d, sections, T);
    expect(d.imageRefs.resolve).toHaveBeenCalledWith(["m-foreign"], T);
    expect(d.linkTargets.resolve).toHaveBeenCalledWith(
      { collection: ["c-foreign"], product: [], page: [] },
      T,
    );
    expect(loaded.images).toEqual({});
    expect(Object.keys(loaded.targets.collection)).toEqual([]);
    const out = resolveSections(sections, loaded, "live");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "hero", settings: { image: null } });
    expect(JSON.stringify(out)).not.toMatch(/foreign|theirs/i);
    // The same ids resolve for their own shop: the port, not the resolver, scopes them.
    const theirs = await loadResolutionContext(d, sections, "t-2");
    expect(Object.keys(theirs.images)).toEqual(["m-foreign"]);
  });

  it("each read degrades on its own and is logged with the tenant and the message only", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const sections = [
      hero({
        image: "m1",
        heading: { en: "Hi" },
        buttonLabel: { en: "Go" },
        buttonLink: { type: "home" },
      }),
      fc("c1"),
      bar({ type: "policy", policy: "refund" }),
    ];
    const reject = (message: string) => vi.fn(() => Promise.reject(new Error(message)));

    const noImages = deps();
    noImages.imageRefs.resolve.mockRejectedValue(new Error("media down"));
    const a = await loadResolutionContext(noImages, sections, T);
    expect(a.images).toEqual({});
    expect(Object.keys(a.targets.collection)).toEqual(["c1"]);
    expect([...a.setPolicies]).toEqual(["refund"]);
    expect(warn).toHaveBeenLastCalledWith("storefront home: images unavailable", {
      tenantId: T,
      error: "media down",
    });

    const noTargets = deps();
    noTargets.linkTargets.resolve.mockRejectedValue(new Error("catalogue down"));
    const b = await loadResolutionContext(noTargets, sections, T);
    expect(Object.keys(b.targets.collection)).toEqual([]);
    expect(Object.keys(b.images)).toEqual(["m1"]);
    expect(warn).toHaveBeenLastCalledWith("storefront home: link targets unavailable", {
      tenantId: T,
      error: "catalogue down",
    });

    const noPolicies = deps({ policies: { list: reject("db down") } });
    const c = await loadResolutionContext(noPolicies, sections, T);
    expect([...c.setPolicies]).toEqual([]);
    expect(Object.keys(c.targets.collection)).toEqual(["c1"]);
    expect(warn).toHaveBeenLastCalledWith("storefront home: policies unavailable", {
      tenantId: T,
      error: "db down",
    });
    expect(resolveSections(sections, c, "live")).toMatchObject([
      { type: "hero", settings: { button: { link: { href: "/" } } } },
      { type: "featured_collection" },
      { type: "announcement_bar", settings: { link: null } },
    ]);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
