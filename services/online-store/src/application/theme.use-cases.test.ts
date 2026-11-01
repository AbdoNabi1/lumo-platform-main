import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
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
