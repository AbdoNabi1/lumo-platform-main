import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HOMEPAGE_SECTIONS,
  DEFAULT_THEME_DOCUMENT,
  newSection,
} from "@platform/storefront-content";
import { logger } from "@platform/utils";
import type { LinkTarget } from "./ports";
import { harness } from "../testing/fakes";

type Doc = ReturnType<typeof JSON.parse>;

const T = "t-1";
const doc = (patch: (d: Doc) => void = () => undefined): Doc => {
  const d = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
  patch(d);
  return d;
};

describe("theme use cases", () => {
  it("a never-saved shop reads the default document as draft, nothing published, version 0", async () => {
    const { controller } = harness();
    const res = await controller.getTheme({ tenantId: T });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      draft: DEFAULT_THEME_DOCUMENT,
      published: null,
      draftRevision: 0,
      publishedDraftRevision: null,
      releaseNumber: 0,
      hasUnpublishedChanges: false,
      images: {},
      version: 0,
    });
  });

  it("saves a draft, bumps the revision, and returns contrast warnings", async () => {
    const { controller } = harness();
    const res = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => {
        d.brand.colors.background = "#FFFFFF";
        d.brand.colors.foreground = "#888888";
      }),
    });
    expect(res).toEqual({
      status: 200,
      body: {
        draftRevision: 1,
        version: 1,
        warnings: [{ pair: "foreground", ratio: 3.54, minimum: 4.5 }],
      },
    });
  });

  it("refuses unreadable body text, a bad colour, unknown keys and a foreign image — writing nothing", async () => {
    const { controller, repos } = harness({ owned: { "t-other": ["img-b"] } });
    const contrast = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => {
        d.brand.colors.background = "#ffffff";
        d.brand.colors.foreground = "#eeeeee";
      }),
    });
    expect(contrast.status).toBe(422);
    expect(contrast.body).toMatchObject({
      fields: [{ field: "brand.colors.foreground", message: "CONTRAST_TOO_LOW" }],
    });
    const colour = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.brand.colors.primary = "red")),
    });
    expect(colour.body).toMatchObject({
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    const unknown = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.surprise = true)),
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body).toMatchObject({
      fields: [{ field: "surprise", message: "UNKNOWN_KEY" }],
    });
    const foreign = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.brand.logo.imageRef = "img-b")),
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body).toMatchObject({
      code: "IMAGE_NOT_FOUND",
      fields: [{ field: "brand.logo.imageRef", message: "IMAGE_NOT_FOUND" }],
    });
    expect((await repos.themes.get(T)).snapshot().persisted).toBe(false);
  });

  it("answers DOCUMENT_TOO_LARGE as the top-level code", async () => {
    const { controller } = harness();
    const res = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: { pad: "x".repeat(300_000) },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "DOCUMENT_TOO_LARGE" });
  });

  it("two tabs: the second save from the same version is VERSION_CONFLICT", async () => {
    const { controller } = harness();
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc() });
    const second = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc(),
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("publish after another save → DRAFT_CHANGED, nothing written (Review Focus 4)", async () => {
    const { controller, repos, recorded } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 1,
      document: doc((d) => (d.brand.corners = "pill")),
    });
    const res = await controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 1,
      by: "admin-1",
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "DRAFT_CHANGED" });
    expect((await repos.themes.get(T)).snapshot()).toMatchObject({
      published: null,
      releaseNumber: 0,
      version: 2,
    });
    expect(await repos.releases.list(T, 20)).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("publishes, records the release and the event, and refuses an unchanged re-publish", async () => {
    const { controller, recorded } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    const res = await controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 1,
      by: "admin-1",
    });
    expect(res).toEqual({
      status: 200,
      body: { releaseNumber: 1, publishedAt: "2026-10-27T10:00:00.000Z" },
    });
    expect(recorded).toEqual([{ tenantId: T, type: "online_store.theme.published" }]);
    const again = await controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 1,
      by: "admin-1",
    });
    expect(again.body).toMatchObject({ code: "NOTHING_TO_PUBLISH" });
  });

  it("keeps the last 20 releases (the 21st publish prunes release 1)", async () => {
    const { controller } = harness();
    let version = 0;
    for (let n = 1; n <= 21; n += 1) {
      const saved = await controller.saveThemeDraft({
        tenantId: T,
        expectedVersion: version,
        document: doc((d) => (d.brand.logo.widthPx = 60 + n)),
      });
      const body = saved.body as { draftRevision: number; version: number };
      await controller.publishTheme({
        tenantId: T,
        expectedDraftRevision: body.draftRevision,
        by: "a",
      });
      version = body.version + 1;
    }
    const list = await controller.listThemeReleases({ tenantId: T });
    const numbers = (list.body as { releases: { releaseNumber: number; publishedByName: null }[] })
      .releases;
    expect(numbers).toHaveLength(20);
    expect(numbers[0]).toEqual({
      releaseNumber: 21,
      publishedAt: "2026-10-27T10:00:00.000Z",
      publishedByName: null,
    });
    expect(numbers.at(-1)?.releaseNumber).toBe(2);
  });

  it("restore copies a release into the draft only", async () => {
    const { controller, recorded } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 2,
      document: doc((d) => (d.brand.corners = "square")),
    });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 2, by: "a" });
    const restored = await controller.restoreThemeRelease({
      tenantId: T,
      releaseNumber: 1,
      expectedVersion: 4,
    });
    expect(restored).toEqual({ status: 200, body: { draftRevision: 3, version: 5 } });
    const state = (await controller.getTheme({ tenantId: T })).body as {
      draft: Doc;
      published: Doc;
      releaseNumber: number;
      publishedDraftRevision: number;
      hasUnpublishedChanges: boolean;
    };
    expect(state.draft).toEqual(doc((d) => (d.header.sticky = true)));
    expect(state.published).toEqual(doc((d) => (d.brand.corners = "square")));
    expect(state.releaseNumber).toBe(2);
    expect(state.publishedDraftRevision).toBe(2);
    expect(state.hasUnpublishedChanges).toBe(true);
    expect(recorded).toHaveLength(2);
  });

  it("restoring the live release leaves no unpublished changes; an unknown one is RELEASE_NOT_FOUND", async () => {
    const { controller } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 2,
      document: doc((d) => (d.brand.corners = "square")),
    });
    const restored = await controller.restoreThemeRelease({
      tenantId: T,
      releaseNumber: 1,
      expectedVersion: 3,
    });
    expect(restored).toEqual({ status: 200, body: { draftRevision: 3, version: 4 } });
    const state = (await controller.getTheme({ tenantId: T })).body as {
      draft: Doc;
      published: Doc;
      hasUnpublishedChanges: boolean;
    };
    expect(state.draft.header.sticky).toBe(true);
    expect(state.hasUnpublishedChanges).toBe(false);
    const missing = await controller.restoreThemeRelease({
      tenantId: T,
      releaseNumber: 9,
      expectedVersion: 4,
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "RELEASE_NOT_FOUND" });
  });

  it("discard returns the draft to the published document", async () => {
    const { controller } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 2,
      document: doc((d) => (d.brand.corners = "square")),
    });
    await controller.discardThemeDraft({ tenantId: T, expectedVersion: 3 });
    const state = (await controller.getTheme({ tenantId: T })).body as {
      draft: Doc;
      hasUnpublishedChanges: boolean;
    };
    expect(state.draft).toEqual(doc((d) => (d.header.sticky = true)));
    expect(state.hasUnpublishedChanges).toBe(false);
  });

  it("discard returns the draft to live and resolves images for both documents in one read", async () => {
    const { controller } = harness({ owned: { [T]: ["logo-1"] } });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.brand.logo.imageRef = "logo-1")),
    });
    const discarded = await controller.discardThemeDraft({ tenantId: T, expectedVersion: 1 });
    expect(discarded).toEqual({ status: 200, body: { draftRevision: 2, version: 2 } });
    const afterDiscard = (await controller.getTheme({ tenantId: T })).body as {
      draft: Doc;
      hasUnpublishedChanges: boolean;
    };
    expect(afterDiscard.draft).toEqual(DEFAULT_THEME_DOCUMENT); // nothing published: the default
    expect(afterDiscard.hasUnpublishedChanges).toBe(false);
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 2,
      document: doc((d) => (d.brand.logo.imageRef = "logo-1")),
    });
    const state = (await controller.getTheme({ tenantId: T })).body as {
      images: Record<string, unknown>;
    };
    expect(Object.keys(state.images)).toEqual(["logo-1"]);
  });

  it("a lost first-write race is VERSION_CONFLICT, not a crash", async () => {
    const { controller } = harness();
    const [a, b] = await Promise.all([
      controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc() }),
      controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((a.status === 409 ? a : b).body).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("two simultaneous publishes make one release: themes.save serialises them", async () => {
    const { controller, repos, recorded } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    const publish = () =>
      controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "admin-1" });
    const [a, b] = await Promise.all([publish(), publish()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((a.status === 409 ? a : b).body).toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await repos.releases.list(T, 20)).toHaveLength(1);
    expect(recorded).toEqual([{ tenantId: T, type: "online_store.theme.published" }]);
  });

  it("saves the theme before appending the release: append relies on the version guard", async () => {
    const { controller, repos } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    const save = vi.spyOn(repos.themes, "save");
    const append = vi.spyOn(repos.releases, "append");
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "admin-1" });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      append.mock.invocationCallOrder[0] as number,
    );
  });

  it("a stale version on discard or restore is VERSION_CONFLICT and changes nothing", async () => {
    const { controller, repos } = harness();
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc() });
    const discard = await controller.discardThemeDraft({ tenantId: T, expectedVersion: 0 });
    const restore = await controller.restoreThemeRelease({
      tenantId: T,
      releaseNumber: 1,
      expectedVersion: 0,
    });
    expect(discard.body).toMatchObject({ code: "VERSION_CONFLICT" });
    expect(restore.body).toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await repos.themes.get(T)).snapshot()).toMatchObject({ draftRevision: 1, version: 1 });
  });

  it("an unknown release leaves the draft untouched", async () => {
    const { controller, repos } = harness();
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc() });
    await controller.restoreThemeRelease({ tenantId: T, releaseNumber: 9, expectedVersion: 1 });
    expect((await repos.themes.get(T)).snapshot()).toMatchObject({ draftRevision: 1, version: 1 });
  });

  it("refuses a foreign favicon on its own path", async () => {
    const { controller } = harness({ owned: { [T]: ["logo-1"] } });
    const res = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => {
        d.brand.logo.imageRef = "logo-1";
        d.brand.favicon.imageRef = "icon-x";
      }),
    });
    expect(res.body).toMatchObject({
      code: "IMAGE_NOT_FOUND",
      fields: [{ field: "brand.favicon.imageRef", message: "IMAGE_NOT_FOUND" }],
    });
  });
});

// ---- Part 3: sections in the draft save and the theme read (spec 3.3, 3.4, Rulings 6, 21) ----

const ID1 = "6f1b2c3d-4e5f-4a6b-8c7d-000000000001";
const ID2 = "6f1b2c3d-4e5f-4a6b-8c7d-000000000002";
const ID3 = "6f1b2c3d-4e5f-4a6b-8c7d-000000000003";
const docOf = (d: unknown): Doc => JSON.parse(JSON.stringify(d));
const withSections = (sections: unknown[]): Doc => ({
  ...docOf(DEFAULT_THEME_DOCUMENT),
  homepage: { sections },
});
const live = (title: string, slug: string): LinkTarget => ({
  href: `/collections/${slug}`,
  title,
  published: true,
  slug,
});
const fc = (collection: string | null, id = ID1) => ({
  ...newSection("featured_collection", id),
  settings: { ...newSection("featured_collection", id).settings, collection },
});
const heroWith = (image: string | null, id = ID2) => ({
  ...newSection("hero", id),
  settings: { ...newSection("hero", id).settings, image },
});
const manualProducts = (products: string[], id = ID3) => ({
  ...newSection("featured_products", id),
  settings: { ...newSection("featured_products", id).settings, source: "manual", products },
});

/** A document Part 1 stored: schema version 1, homepage never edited (T3's v1 fixture shape). */
const PART1_V1_DOC = {
  schemaVersion: 1,
  brand: {
    logo: { imageRef: null, widthPx: 140 },
    favicon: { imageRef: null },
    colors: {
      background: "#ffffff",
      foreground: "#111111",
      primary: "#1d4ed8",
      primaryForeground: "#ffffff",
      accent: "#f59e0b",
      accentForeground: "#111111",
    },
    typography: {
      headingFont: "ibm-plex-sans-arabic",
      bodyFont: "ibm-plex-sans-arabic",
      baseSize: "medium",
    },
    corners: "rounded",
    social: {},
  },
  header: { sticky: false },
  footer: { note: {}, showSocial: true },
  homepage: { sections: [] },
};

describe("sections in the draft (spec 3.3, 3.4, Ruling 6)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("saves a section that names the shop's own collection and image", async () => {
    const h = harness({
      owned: { [T]: ["m1"] },
      targets: { [T]: { collection: { c1: live("Sale", "sale") } } },
    });
    const res = await h.save(withSections([fc("c1"), heroWith("m1")]), 0);
    expect(res.status).toBe(200);
    expect(h.writes()).toBe(1);
  });

  it("a new foreign collection is TARGET_NOT_FOUND at its path, nothing written", async () => {
    const h = harness({
      targets: { [T]: { collection: {} }, "t-other": { collection: { c9: live("X", "x") } } },
    });
    const res = await h.save(withSections([fc("c9")]), 0);
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: "TARGET_NOT_FOUND",
        fields: [{ field: "homepage.sections.0.settings.collection", message: "TARGET_NOT_FOUND" }],
      },
    });
    expect(h.writes()).toBe(0);
  });

  it("an inherited member name is never a target: constructor and __proto__ are TARGET_NOT_FOUND", async () => {
    const h = harness({ targets: { [T]: { collection: {} } } });
    const res = await h.save(withSections([fc("constructor"), fc("__proto__", ID2)]), 0);
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: "TARGET_NOT_FOUND",
        fields: [
          { field: "homepage.sections.0.settings.collection", message: "TARGET_NOT_FOUND" },
          { field: "homepage.sections.1.settings.collection", message: "TARGET_NOT_FOUND" },
        ],
      },
    });
    expect(h.writes()).toBe(0);
  });

  it("a new foreign image in an item is IMAGE_NOT_FOUND at the item's path, nothing written", async () => {
    const list = {
      ...newSection("collection_list", ID1),
      settings: {
        ...newSection("collection_list", ID1).settings,
        source: "manual",
        items: [{ collection: null, image: "theirs" }],
      },
    };
    const h = harness({ owned: { [T]: [], "t-other": ["theirs"] } });
    const res = await h.save(withSections([list]), 0);
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: "IMAGE_NOT_FOUND",
        fields: [
          { field: "homepage.sections.0.settings.items.0.image", message: "IMAGE_NOT_FOUND" },
        ],
      },
    });
    expect(h.writes()).toBe(0);
  });

  it("a new foreign or unknown hero image is refused with no write; a stored one is not re-checked", async () => {
    const mine = ["m1"];
    const h = harness({ owned: { [T]: mine, "t-other": ["theirs"] } });
    for (const image of ["theirs", "nowhere"]) {
      const refused = await h.save(withSections([heroWith(image)]), 0);
      expect(refused).toMatchObject({
        status: 422,
        body: {
          code: "IMAGE_NOT_FOUND",
          fields: [{ field: "homepage.sections.0.settings.image", message: "IMAGE_NOT_FOUND" }],
        },
      });
    }
    expect(h.writes()).toBe(0);
    expect((await h.save(withSections([heroWith("m1")]), 0)).status).toBe(200);
    mine.length = 0; // the merchant archived m1 after placing it
    const later = await h.save(
      {
        ...withSections([heroWith("m1")]),
        header: { ...DEFAULT_THEME_DOCUMENT.header, sticky: true },
      },
      1,
    );
    expect(later.status).toBe(200);
    expect(h.writes()).toBe(2);
  });

  it("a reference already in the draft is not re-checked (a deleted collection still saves)", async () => {
    const h = harness({ targets: { [T]: { collection: { c1: live("Sale", "sale") } } } });
    expect((await h.save(withSections([fc("c1")]), 0)).status).toBe(200);
    h.deleteTarget("collection", "c1");
    const res = await h.save(
      {
        ...withSections([fc("c1")]),
        brand: { ...docOf(DEFAULT_THEME_DOCUMENT).brand, corners: "pill" },
      },
      1,
    );
    expect(res.status).toBe(200);
    expect(h.resolveCalls).toHaveLength(1); // only the first save resolved: nothing new, no call
  });

  it("a reference in the published document is known too (re-adding a deleted collection saves)", async () => {
    const h = harness({ targets: { [T]: { collection: { c1: live("Sale", "sale") } } } });
    expect((await h.save(withSections([fc("c1")]), 0)).status).toBe(200);
    const published = await h.controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 1,
      by: "admin-1",
    });
    expect(published.status).toBe(200);
    expect((await h.save(withSections([]), 2)).status).toBe(200); // removed from the draft
    h.deleteTarget("collection", "c1");
    const res = await h.save(withSections([fc("c1")]), 3); // back again: live still names it
    expect(res.status).toBe(200);
    expect(h.resolveCalls).toHaveLength(1);
  });

  it("issues come images first, then collections, products and pages, each in document order", async () => {
    const h = harness({ owned: { [T]: [] }, targets: { [T]: {} } });
    const hero = {
      ...heroWith("img-x", ID1),
      settings: { ...heroWith("img-x", ID1).settings, buttonLink: { type: "page", id: "g-x" } },
    };
    const res = await h.save(
      withSections([hero, manualProducts(["p-x", "p-y"], ID2), fc("c-x", ID3)]),
      0,
    );
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: "IMAGE_NOT_FOUND",
        message: "IMAGE_NOT_FOUND: The highlighted item no longer exists in this store.",
        fields: [
          { field: "homepage.sections.0.settings.image", message: "IMAGE_NOT_FOUND" },
          { field: "homepage.sections.2.settings.collection", message: "TARGET_NOT_FOUND" },
          { field: "homepage.sections.1.settings.products.0", message: "TARGET_NOT_FOUND" },
          { field: "homepage.sections.1.settings.products.1", message: "TARGET_NOT_FOUND" },
          { field: "homepage.sections.0.settings.buttonLink.id", message: "TARGET_NOT_FOUND" },
        ],
      },
    });
    expect(h.resolveCalls).toEqual([4]); // one batched read for the three kinds
    expect(h.writes()).toBe(0);
  });

  it("a stale version is VERSION_CONFLICT before any reference read", async () => {
    const h = harness({ owned: { [T]: [] }, targets: { [T]: { collection: {} } } });
    expect((await h.save(withSections([]), 0)).status).toBe(200);
    // A foreign image too: were references read first, this would answer IMAGE_NOT_FOUND.
    const res = await h.save(withSections([fc("x"), heroWith("img-x")]), 7);
    expect(res).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect(h.resolveCalls).toHaveLength(0);
    expect(h.writes()).toBe(1);
  });

  it("a failed reference read throws (500, retried), never a 422, nothing written", async () => {
    const h = harness({ linkTargetsFail: true });
    await expect(h.save(withSections([fc("c1")]), 0)).rejects.toThrow("catalogue down");
    expect(h.writes()).toBe(0);
  });

  it("the shop's own logo still saves; a foreign logo is still IMAGE_NOT_FOUND", async () => {
    const h = harness({ owned: { [T]: ["logo-1"], "t-other": ["logo-x"] } });
    const foreign = await h.save(
      doc((d) => (d.brand.logo.imageRef = "logo-x")),
      0,
    );
    expect(foreign).toMatchObject({
      status: 422,
      body: {
        code: "IMAGE_NOT_FOUND",
        fields: [{ field: "brand.logo.imageRef", message: "IMAGE_NOT_FOUND" }],
      },
    });
    const own = await h.save(
      doc((d) => (d.brand.logo.imageRef = "logo-1")),
      0,
    );
    expect(own.status).toBe(200);
  });

  it("a Part 1 draft equal to live has no unpublished changes after the upgrade (Review Focus 1)", async () => {
    const h = harness();
    await h.seedThemeRow({ draft: PART1_V1_DOC, published: PART1_V1_DOC, version: 3 });
    const state = await h.controller.getTheme({ tenantId: T });
    expect(state.status).toBe(200);
    const body = state.body as { hasUnpublishedChanges: boolean; draft: Doc; version: number };
    expect(body.hasUnpublishedChanges).toBe(false);
    expect(body.version).toBe(3);
    expect(body.draft.schemaVersion).toBe(2);
    expect(body.draft.brand.colors.primary).toBe("#1d4ed8");
    expect(body.draft.homepage.sections).toEqual(DEFAULT_HOMEPAGE_SECTIONS);
  });

  it("after the first autosave the draft is v2 with the default sections, live still v1: nothing to publish", async () => {
    const h = harness();
    await h.seedThemeRow({ draft: PART1_V1_DOC, published: PART1_V1_DOC, version: 3 });
    const read = await h.controller.getTheme({ tenantId: T });
    expect(read.status).toBe(200);
    const saved = await h.save((read.body as { draft: Doc }).draft, 3);
    expect(saved).toMatchObject({ status: 200, body: { draftRevision: 2, version: 4 } });
    const stored = (await h.repos.themes.get(T)).snapshot();
    expect(stored.draft.schemaVersion).toBe(2);
    expect(stored.draft.homepage.sections).toEqual(DEFAULT_HOMEPAGE_SECTIONS);
    const state = await h.controller.getTheme({ tenantId: T });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ hasUnpublishedChanges: false });
    const publish = await h.controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 2,
      by: "admin-1",
    });
    expect(publish).toMatchObject({ status: 409, body: { code: "NOTHING_TO_PUBLISH" } });
  });
});

describe("the theme read's section images and targets (Ruling 21)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A draft with a hero (m1), a featured collection (c1 live) and products (p-gone, p-draft). */
  const seeded = async () => {
    const options: Parameters<typeof harness>[0] = {
      owned: { [T]: ["m1"] },
      targets: {
        [T]: {
          collection: { c1: live("Sale", "sale") },
          product: {
            "p-gone": { href: "/products/gone", title: "Gone", published: true, slug: "gone" },
            "p-draft": { href: "/products/soon", title: "Soon", published: false, slug: "soon" },
          },
        },
      },
      linkTargetsFail: false,
    };
    const h = harness(options);
    const saved = await h.save(
      withSections([heroWith("m1", ID1), fc("c1", ID2), manualProducts(["p-gone", "p-draft"])]),
      0,
    );
    expect(saved.status).toBe(200);
    h.deleteTarget("product", "p-gone");
    return { h, options };
  };

  it("resolves section images and the draft's targets in one targets read; a gone one is absent", async () => {
    const { h } = await seeded();
    const before = h.resolveCalls.length;
    const state = await h.controller.getTheme({ tenantId: T });
    expect(state.status).toBe(200);
    const body = state.body as {
      images: Record<string, unknown>;
      targets: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(body.images)).toEqual(["m1"]);
    expect(h.resolveCalls.slice(before)).toEqual([3]);
    expect(body.targets).toEqual({
      collection: { c1: { title: "Sale", live: true } },
      product: { "p-draft": { title: "Soon", live: false } },
      page: {},
    });
    expect(Object.hasOwn(body.targets["product"] ?? {}, "p-gone")).toBe(false);
  });

  it("a draft naming no target reads no targets: empty maps, no call", async () => {
    const h = harness();
    const state = await h.controller.getTheme({ tenantId: T });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ targets: { collection: {}, product: {}, page: {} } });
    expect(h.resolveCalls).toEqual([]);
  });

  it("a failed targets read gives targets: null, never a broken flag, and logs no merchant text", async () => {
    const { h, options } = await seeded();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    if (options !== undefined) options.linkTargetsFail = true;
    const state = await h.controller.getTheme({ tenantId: T });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ targets: null, images: { m1: expect.anything() } });
    expect(warn).toHaveBeenCalledWith("online-store theme: link targets unavailable", {
      tenantId: T,
      error: "catalogue down",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Sale|Soon|c1|p-draft/);
  });
});
