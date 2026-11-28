import { beforeEach, describe, expect, it } from "vitest";
import { HOMEPAGE_SECTIONS_MAX, IMAGE_ALT_MAX, SECTION_LIMITS } from "@platform/storefront-content";
import { readPublicSection, readPublicSections } from "./public-sections";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IMG = { url: "https://cdn.test/a.png", alt: "A lamp", width: 800, height: 600 };
const LINK = { href: "/search", external: false };
const COLLECTION = { id: "col_1", slug: "summer-sale", name: "Summer sale" };
const RLO = String.fromCharCode(0x202e);

type Settings = Record<string, unknown>;
const section = (type: string, settings: Settings, extra: Settings = {}, n = 1) => ({
  id: id(n),
  type,
  settings,
  ...extra,
});

const hero = (over: Settings = {}) =>
  section("hero", {
    image: IMG,
    mobileImage: null,
    heading: { ar: "أهلًا", en: "Hello" },
    subheading: {},
    button: { label: { en: "Shop" }, link: LINK },
    height: "medium",
    contentAlign: "center",
    overlay: 30,
    ...over,
  });
const bar = (over: Settings = {}) =>
  section("announcement_bar", {
    text: { en: "Free shipping" },
    link: LINK,
    style: "primary",
    ...over,
  });
const products = (over: Settings = {}) =>
  section("featured_products", {
    source: "manual",
    productIds: ["p1", "p2"],
    heading: { en: "Picks" },
    columns: 3,
    ...over,
  });
const featuredCollection = (over: Settings = {}) =>
  section("featured_collection", {
    collection: COLLECTION,
    heading: { en: "Sale" },
    productCount: 6,
    columns: 3,
    showViewAll: false,
    ...over,
  });
const whatsapp = (over: Settings = {}) =>
  section("whatsapp_cta", {
    heading: { en: "Chat" },
    text: { en: "We answer" },
    buttonLabel: { en: "Message us" },
    phone: "201001234567",
    message: { en: "Hi" },
    ...over,
  });
const leadForm = (over: Settings = {}) =>
  section("lead_form", {
    heading: { en: "Get in touch" },
    text: { en: "Leave your details" },
    submitLabel: { en: "Send" },
    successMessage: { en: "Thanks" },
    showEmail: true,
    showMessage: true,
    ...over,
  });

beforeEach(() => {
  expect.hasAssertions();
});

describe("readPublicSection: the storefront re-validates everything (spec Security, Ruling 13)", () => {
  it("keeps a valid section of each kind, field by field", () => {
    expect(readPublicSection(hero(), "live")).toEqual({
      id: id(1),
      type: "hero",
      settings: {
        image: IMG,
        mobileImage: null,
        heading: { ar: "أهلًا", en: "Hello" },
        subheading: {},
        button: { label: { en: "Shop" }, link: LINK },
        height: "medium",
        contentAlign: "center",
        overlay: 30,
      },
    });
    expect(readPublicSection(featuredCollection(), "live")).toEqual({
      id: id(1),
      type: "featured_collection",
      settings: {
        collection: COLLECTION,
        heading: { en: "Sale" },
        productCount: 6,
        columns: 3,
        showViewAll: false,
      },
    });
    expect(readPublicSection(whatsapp(), "live")).toMatchObject({
      settings: { phone: "201001234567", buttonLabel: { en: "Message us" } },
    });
  });

  it("a lead form is kept with its six settings, even when empty of text", () => {
    expect(readPublicSection(leadForm(), "live")).toEqual({
      id: id(1),
      type: "lead_form",
      settings: {
        heading: { en: "Get in touch" },
        text: { en: "Leave your details" },
        submitLabel: { en: "Send" },
        successMessage: { en: "Thanks" },
        showEmail: true,
        showMessage: true,
      },
    });
    const bare = readPublicSection(
      leadForm({ heading: {}, text: {}, submitLabel: {}, successMessage: {} }),
      "live",
    );
    expect(bare).toMatchObject({ type: "lead_form" });
    expect(bare).not.toHaveProperty("incomplete");
  });

  it("a lead form keeps false flags and reads a missing or odd flag as true", () => {
    expect(
      readPublicSection(leadForm({ showEmail: false, showMessage: false }), "live"),
    ).toMatchObject({ settings: { showEmail: false, showMessage: false } });
    expect(
      readPublicSection(leadForm({ showEmail: "no", showMessage: undefined }), "live"),
    ).toMatchObject({ settings: { showEmail: true, showMessage: true } });
  });

  it("at most one lead form is kept", () => {
    const forms = Array.from({ length: 3 }, (_, i) => ({ ...leadForm(), id: id(i + 20) }));
    expect(readPublicSections(forms, "live")).toHaveLength(SECTION_LIMITS.leadFormPerPage);
  });

  it("a javascript: href or a //evil link becomes null", () => {
    const js = readPublicSection(
      bar({ link: { href: "javascript:alert(1)", external: false } }),
      "live",
    );
    expect(js).toMatchObject({ type: "announcement_bar", settings: { link: null } });
    const protocolRelative = readPublicSection(
      bar({ link: { href: "//evil.test/x", external: false } }),
      "live",
    );
    expect(protocolRelative).toMatchObject({ settings: { link: null } });
    // A button whose link fails is no button at all.
    const button = readPublicSection(
      hero({ button: { label: { en: "Go" }, link: { href: "javascript:x", external: false } } }),
      "live",
    );
    expect(button).toMatchObject({ settings: { button: null } });
  });

  it("recomputes `external` from the href, whatever the body claims", () => {
    const external = readPublicSection(
      bar({ link: { href: "https://example.com/a", external: false } }),
      "live",
    );
    expect(external).toMatchObject({
      settings: { link: { href: "https://example.com/a", external: true } },
    });
    const internal = readPublicSection(bar({ link: { href: "/search", external: true } }), "live");
    expect(internal).toMatchObject({ settings: { link: { href: "/search", external: false } } });
  });

  it("an http: image becomes null; alt is capped at the shared IMAGE_ALT_MAX", () => {
    const http = readPublicSection(
      hero({ image: { ...IMG, url: "http://cdn.test/a.png" } }),
      "live",
    );
    expect(http).toMatchObject({ settings: { image: null } });
    const longAlt = readPublicSection(hero({ image: { ...IMG, alt: "a".repeat(400) } }), "live");
    const settings = (longAlt as { settings: { image: { alt: string } } }).settings;
    expect(settings.image.alt).toHaveLength(IMAGE_ALT_MAX);
  });

  it("a hero overlay of 85 (or off its step) falls back to the definition's default, 30 (F15)", () => {
    expect(readPublicSection(hero({ overlay: 85 }), "live")).toMatchObject({
      settings: { overlay: 30 },
    });
    expect(readPublicSection(hero({ overlay: 25 }), "live")).toMatchObject({
      settings: { overlay: 30 },
    });
    expect(readPublicSection(hero({ overlay: "80" }), "live")).toMatchObject({
      settings: { overlay: 30 },
    });
    expect(readPublicSection(hero({ overlay: 80 }), "live")).toMatchObject({
      settings: { overlay: 80 },
    });
  });

  it("columns: 9 falls back to the type's default", () => {
    expect(readPublicSection(products({ columns: 9 }), "live")).toMatchObject({
      settings: { columns: 4 },
    });
    const list = section("collection_list", { source: "all", heading: {}, columns: 9 });
    expect(readPublicSection(list, "live")).toMatchObject({ settings: { columns: 3 } });
    expect(readPublicSection(featuredCollection({ productCount: 50 }), "live")).toMatchObject({
      settings: { productCount: 8 },
    });
  });

  it("an unknown style falls back to accent; an unknown enum falls back to its default", () => {
    expect(readPublicSection(bar({ style: "neon" }), "live")).toMatchObject({
      settings: { style: "accent" },
    });
    expect(
      readPublicSection(hero({ height: "giant", contentAlign: "left" }), "live"),
    ).toMatchObject({
      settings: { height: "medium", contentAlign: "center" },
    });
  });

  it("an unknown source reads as the type's default source (Ruling 7)", () => {
    const fp = readPublicSection(products({ source: "trending", count: 6 }), "live");
    expect(fp).toEqual({
      id: id(1),
      type: "featured_products",
      settings: { source: "newest", count: 6, heading: { en: "Picks" }, columns: 3 },
    });
    const list = readPublicSection(
      section("collection_list", { source: "x", heading: {}, columns: 2 }),
      "live",
    );
    expect(list).toMatchObject({ settings: { source: "all" } });
  });

  it('phone: "0100" drops the WhatsApp section (digits re-checked with isWhatsAppDigits)', () => {
    expect(readPublicSection(whatsapp({ phone: "0100" }), "live")).toBeNull();
    expect(readPublicSection(whatsapp({ phone: "+201001234567" }), "live")).toBeNull();
    expect(readPublicSection(whatsapp({ phone: 201001234567 }), "live")).toBeNull();
  });

  it("hidden is kept only in preview, and only as `hidden === true`", () => {
    const preview = readPublicSection(hero(), "preview");
    expect(preview).toMatchObject({ hidden: false });
    expect(readPublicSection({ ...hero(), hidden: true }, "preview")).toMatchObject({
      hidden: true,
    });
    expect(readPublicSection({ ...hero(), hidden: "yes" }, "preview")).toMatchObject({
      hidden: false,
    });
    // Live never carries the flag, and a live section labelled hidden is not shown.
    const live = readPublicSection(hero(), "live");
    expect(live).not.toBeNull();
    expect(live).not.toHaveProperty("hidden");
    expect(readPublicSection({ ...hero(), hidden: true }, "live")).toBeNull();
  });

  it("an incomplete section is kept only in preview; a live body's incomplete one is skipped (F2)", () => {
    const raw = { id: id(4), type: "featured_collection", hidden: false, incomplete: true };
    expect(readPublicSection(raw, "preview")).toEqual({
      id: id(4),
      type: "featured_collection",
      hidden: false,
      incomplete: true,
    });
    expect(readPublicSection(raw, "live")).toBeNull();
    expect(readPublicSections([raw, hero()], "live").map((s) => s.type)).toEqual(["hero"]);
  });

  it("a section that fails the re-check is skipped live and becomes a placeholder in preview", () => {
    expect(readPublicSection(whatsapp({ phone: "0100" }), "preview")).toEqual({
      id: id(1),
      type: "whatsapp_cta",
      hidden: false,
      incomplete: true,
    });
  });

  it("a bidi override in a heading is stripped (through textOf); over-long text is capped", () => {
    const out = readPublicSection(hero({ heading: { en: `Hi${RLO}there` } }), "live");
    expect(out).toMatchObject({ settings: { heading: { en: "Hithere" } } });
    const long = readPublicSection(hero({ heading: { en: "x".repeat(500) } }), "live");
    const heading = (long as { settings: { heading: { en: string } } }).settings.heading.en;
    expect(heading).toHaveLength(SECTION_LIMITS.heading);
  });

  it("rich-text bodies keep their line breaks (multiline)", () => {
    const raw = section("rich_text", {
      heading: {},
      body: { en: "line one\nline two" },
      button: null,
      align: "start",
    });
    expect(readPublicSection(raw, "live")).toMatchObject({
      settings: { body: { en: "line one\nline two" }, align: "start" },
    });
  });

  it("product ids not matching ^[A-Za-z0-9_-]{1,64}$ are dropped", () => {
    const out = readPublicSection(
      products({ productIds: ["p1", "../x", "", 7, "a".repeat(65), "p_2"] }),
      "live",
    );
    expect(out).toMatchObject({ settings: { source: "manual", productIds: ["p1", "p_2"] } });
    // None left: the manual grid has nothing to show.
    expect(readPublicSection(products({ productIds: ["../x"] }), "live")).toBeNull();
  });

  it("an over-long or duplicated product list falls back whole, never cut (T1 carry)", () => {
    const max = SECTION_LIMITS.products;
    const tooMany = Array.from({ length: max + 1 }, (_, i) => `p${i}`);
    expect(readPublicSection(products({ productIds: tooMany }), "live")).toBeNull();
    expect(readPublicSection(products({ productIds: ["p1", "p1"] }), "live")).toBeNull();
    expect(readPublicSection(products({ productIds: tooMany }), "preview")).toMatchObject({
      incomplete: true,
    });
    const exactly = Array.from({ length: max }, (_, i) => `p${i}`);
    expect(readPublicSection(products({ productIds: exactly }), "live")).toMatchObject({
      settings: { productIds: exactly },
    });
  });

  it("a collection slug of ../..//evil.example is dropped (F5)", () => {
    const evil = { ...COLLECTION, slug: "../..//evil.example" };
    expect(readPublicSection(featuredCollection({ collection: evil }), "live")).toBeNull();
    const list = section("collection_list", {
      source: "manual",
      items: [
        { collection: evil, image: null },
        { collection: COLLECTION, image: IMG },
      ],
      heading: {},
      columns: 2,
    });
    expect(readPublicSection(list, "live")).toMatchObject({
      settings: { source: "manual", items: [{ collection: COLLECTION, image: IMG }] },
    });
  });

  it("collection refs: a malformed id is dropped, the name is clipped to 200", () => {
    expect(
      readPublicSection(featuredCollection({ collection: { ...COLLECTION, id: "" } }), "live"),
    ).toBeNull();
    const out = readPublicSection(
      featuredCollection({ collection: { ...COLLECTION, name: "n".repeat(300) } }),
      "live",
    );
    const name = (out as { settings: { collection: { name: string } } }).settings.collection.name;
    expect(name).toHaveLength(200);
  });

  it("testimonials and features: items without text are dropped, values re-checked, capped", () => {
    const t = section("testimonials", {
      heading: {},
      items: [
        { quote: {}, author: "Nobody", rating: 5 },
        { quote: { en: "Great" }, author: ` Mona${RLO} `, rating: 9 },
      ],
    });
    expect(readPublicSection(t, "live")).toMatchObject({
      settings: { items: [{ quote: { en: "Great" }, author: "Mona", rating: 0 }] },
    });
    const empty = section("testimonials", {
      heading: {},
      items: [{ quote: {}, author: "", rating: 1 }],
    });
    expect(readPublicSection(empty, "live")).toBeNull();
    const many = Array.from({ length: 10 }, () => ({
      icon: "laser",
      title: { en: "T" },
      text: {},
    }));
    const f = readPublicSection(section("features", { heading: {}, items: many }), "live");
    const items = (f as unknown as { settings: { items: { icon: string }[] } }).settings.items;
    expect(items).toHaveLength(SECTION_LIMITS.features.max);
    expect(items[0]!.icon).toBe("cod");
  });

  it("hero, image_with_text and rich_text with nothing to show are dropped live", () => {
    const blank = hero({ image: null, heading: {}, subheading: {}, button: null });
    expect(readPublicSection(blank, "live")).toBeNull();
    const iwt = section("image_with_text", {
      image: { ...IMG, url: "http://x.test/a.png" },
      heading: {},
      body: {},
      button: null,
      imagePosition: "end",
    });
    expect(readPublicSection(iwt, "live")).toBeNull();
    expect(readPublicSection(bar({ text: {} }), "live")).toBeNull();
  });

  it("an envelope without a uuid id or a known type is null", () => {
    expect(readPublicSection({ ...hero(), id: "not-a-uuid" }, "live")).toBeNull();
    expect(readPublicSection({ ...hero(), type: "carousel" }, "live")).toBeNull();
    expect(readPublicSection({ ...hero(), settings: "x" }, "live")).toBeNull();
    expect(readPublicSection(null, "live")).toBeNull();
  });
});

describe("readPublicSections", () => {
  it(`26 sections are cut to ${HOMEPAGE_SECTIONS_MAX}`, () => {
    const many = Array.from({ length: 26 }, (_, i) =>
      section(
        "rich_text",
        { heading: { en: `S${i}` }, body: {}, button: null, align: "start" },
        {},
        i + 1,
      ),
    );
    expect(readPublicSections(many, "live")).toHaveLength(HOMEPAGE_SECTIONS_MAX);
  });

  it("an unknown type, a header-only type and a duplicate id are skipped", () => {
    const out = readPublicSections(
      [
        hero(),
        section("carousel", {}, {}, 2),
        { ...bar(), id: id(3) },
        { ...hero(), id: id(1) },
        whatsapp(),
      ],
      "live",
    );
    expect(out.map((s) => s.type)).toEqual(["hero"]);
    const distinct = readPublicSections(
      [hero(), section("whatsapp_cta", whatsapp().settings, {}, 2)],
      "live",
    );
    expect(distinct.map((s) => s.type)).toEqual(["hero", "whatsapp_cta"]);
  });

  it("per-type limits hold: at most 3 heroes and 2 WhatsApp buttons", () => {
    const heroes = Array.from({ length: 5 }, (_, i) => ({ ...hero(), id: id(i + 1) }));
    expect(readPublicSections(heroes, "live")).toHaveLength(SECTION_LIMITS.heroPerPage);
    const ctas = Array.from({ length: 4 }, (_, i) => ({ ...whatsapp(), id: id(i + 10) }));
    expect(readPublicSections(ctas, "live")).toHaveLength(SECTION_LIMITS.whatsAppPerPage);
  });

  it("anything but an array is no sections", () => {
    expect(readPublicSections({ 0: hero() }, "live")).toEqual([]);
    expect(readPublicSections(undefined, "preview")).toEqual([]);
  });
});
