import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  saveThemeDraft: vi.fn(),
  publishTheme: vi.fn(),
  discardThemeDraft: vi.fn(),
  restoreThemeRelease: vi.fn(),
  issuePreviewToken: vi.fn(),
}));
const media = vi.hoisted(() => ({ fetchLibraryImages: vi.fn(), updateMediaAlt: vi.fn() }));
const side = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/online-store", () => api);
vi.mock("@/lib/api/media", () => media);
vi.mock("@/lib/storefront-revalidate", () => ({ revalidateStorefront: side.revalidateStorefront }));
vi.mock("next/cache", () => ({ revalidatePath: side.revalidatePath }));
const actions = await import("./actions");

const KEY = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  expect.hasAssertions();
  for (const fn of Object.values(api)) fn.mockReset();
  for (const fn of Object.values(media)) fn.mockReset();
  side.revalidateStorefront.mockReset().mockResolvedValue(true);
  side.revalidatePath.mockReset();
  vi.stubEnv("STOREFRONT_URL", "https://shop.example/");
});
afterEach(() => vi.unstubAllEnvs());

describe("theme actions", () => {
  it("draft save maps ok, VERSION_CONFLICT and field issues", async () => {
    api.saveThemeDraft.mockResolvedValueOnce({
      outcome: "ok",
      data: { draftRevision: 4, version: 7, warnings: [] },
    });
    expect(
      await actions.saveThemeDraftAction({ document: {} as never, expectedVersion: 6 }),
    ).toEqual({ status: "ok", draftRevision: 4, version: 7, warnings: [] });
    expect(api.saveThemeDraft).toHaveBeenCalledWith({}, 6, expect.any(String));
    api.saveThemeDraft.mockResolvedValueOnce({
      outcome: "conflict",
      message: "VERSION_CONFLICT: x",
    });
    expect(
      await actions.saveThemeDraftAction({ document: {} as never, expectedVersion: 6 }),
    ).toEqual({ status: "conflict" });
    api.saveThemeDraft.mockResolvedValueOnce({
      outcome: "invalid",
      message: "INVALID_CONTENT: x",
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    expect(
      await actions.saveThemeDraftAction({ document: {} as never, expectedVersion: 6 }),
    ).toEqual({
      status: "invalid",
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    expect(side.revalidateStorefront).not.toHaveBeenCalled(); // a draft never changes the live store
  });

  it("draft save: a duplicate in-flight key (409 with no code) is not a version conflict", async () => {
    api.saveThemeDraft.mockResolvedValueOnce({
      outcome: "conflict",
      message: "A request with this Idempotency-Key is already in flight",
    });
    expect(
      await actions.saveThemeDraftAction({ document: {} as never, expectedVersion: 6 }),
    ).toEqual({ status: "in_flight" });
  });

  it("draft save reuses the caller's key, mints one when absent, refuses a bad one (Ruling 2)", async () => {
    api.saveThemeDraft.mockResolvedValue({ outcome: "error", message: "x" });
    await actions.saveThemeDraftAction({
      document: {} as never,
      expectedVersion: 6,
      idempotencyKey: KEY,
    });
    expect(api.saveThemeDraft).toHaveBeenLastCalledWith({}, 6, KEY);
    await actions.saveThemeDraftAction({
      document: {} as never,
      expectedVersion: 6,
      idempotencyKey: undefined,
    });
    const [, , key] = api.saveThemeDraft.mock.lastCall as [unknown, number, string];
    expect(key).toMatch(/^[A-Za-z0-9-]{16,100}$/);
    api.saveThemeDraft.mockClear();
    for (const bad of ["bad key\n", "short", "a".repeat(101), 7, null, ""]) {
      expect(
        await actions.saveThemeDraftAction({
          document: {} as never,
          expectedVersion: 6,
          idempotencyKey: bad as never,
        }),
      ).toEqual({ status: "error" });
    }
    expect(api.saveThemeDraft).not.toHaveBeenCalled();
  });

  it("publish: DRAFT_CHANGED and NOTHING_TO_PUBLISH are distinct; only success revalidates the storefront", async () => {
    api.publishTheme.mockResolvedValueOnce({ outcome: "conflict", message: "DRAFT_CHANGED: x" });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "draft_changed" });
    api.publishTheme.mockResolvedValueOnce({
      outcome: "conflict",
      message: "NOTHING_TO_PUBLISH: x",
    });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "nothing_to_publish" });
    api.publishTheme.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "forbidden" });
    expect(side.revalidateStorefront).not.toHaveBeenCalled();
    api.publishTheme.mockResolvedValueOnce({
      outcome: "ok",
      data: { releaseNumber: 2, publishedAt: "2026-10-27T10:00:00.000Z" },
    });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "ok", releaseNumber: 2 });
    expect(side.revalidateStorefront).toHaveBeenCalledTimes(1);
  });

  it("publish: a VERSION_CONFLICT (lost race in the transaction) is draft_changed (carried ruling)", async () => {
    api.publishTheme.mockResolvedValueOnce({
      outcome: "conflict",
      message: "VERSION_CONFLICT: x",
    });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "draft_changed" });
  });

  it("publish: a duplicate in-flight key is in_flight, apart from both conflicts", async () => {
    api.publishTheme.mockResolvedValueOnce({
      outcome: "conflict",
      message: "A request with this Idempotency-Key is already in flight",
    });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "in_flight" });
    api.publishTheme.mockResolvedValueOnce({ outcome: "conflict", message: "SOMETHING_ELSE: x" });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "error" });
  });

  it("publish sends the caller's key and the previewed revision; a failed nudge is liveDelayed", async () => {
    side.revalidateStorefront.mockResolvedValueOnce(false);
    api.publishTheme.mockResolvedValueOnce({
      outcome: "ok",
      data: { releaseNumber: 5, publishedAt: "2026-10-27T10:00:00.000Z" },
    });
    expect(await actions.publishThemeAction(9, KEY)).toEqual({
      status: "ok",
      releaseNumber: 5,
      liveDelayed: true,
    });
    expect(api.publishTheme).toHaveBeenCalledWith(9, KEY);
    expect(side.revalidatePath).toHaveBeenCalledWith("/online-store/themes");
  });

  it("publish mints an absent key and refuses a present but malformed one, with no API call", async () => {
    api.publishTheme.mockResolvedValue({ outcome: "error", message: "x" });
    await actions.publishThemeAction(9);
    const [, minted] = api.publishTheme.mock.lastCall as [number, string];
    expect(minted).toMatch(/^[A-Za-z0-9-]{16,100}$/);
    api.publishTheme.mockClear();
    for (const bad of ["bad key\n", "short", "a".repeat(101), 7, null, ""]) {
      expect(await actions.publishThemeAction(9, bad as never)).toEqual({ status: "error" });
    }
    expect(api.publishTheme).not.toHaveBeenCalled();
  });

  it("restore goes to the draft only: no storefront revalidation; 404 is not_found", async () => {
    api.restoreThemeRelease.mockResolvedValueOnce({
      outcome: "ok",
      data: { draftRevision: 8, version: 9 },
    });
    expect(await actions.restoreReleaseAction(2, 7)).toEqual({
      status: "ok",
      draftRevision: 8,
      version: 9,
    });
    expect(api.restoreThemeRelease).toHaveBeenCalledWith(2, 7, expect.any(String));
    api.restoreThemeRelease.mockResolvedValueOnce({ outcome: "not_found" });
    expect(await actions.restoreReleaseAction(99, 7)).toEqual({ status: "not_found" });
    api.restoreThemeRelease.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await actions.restoreReleaseAction(2, 7)).toEqual({ status: "forbidden" });
    expect(side.revalidateStorefront).not.toHaveBeenCalled();
  });

  it("discard maps a version conflict", async () => {
    api.discardThemeDraft.mockResolvedValueOnce({
      outcome: "conflict",
      message: "VERSION_CONFLICT: x",
    });
    expect(await actions.discardThemeDraftAction(4)).toEqual({ status: "conflict" });
  });

  it("preview url: the primary-host url, else STOREFRONT_URL + ?preview=, else an error", async () => {
    api.issuePreviewToken.mockResolvedValueOnce({
      outcome: "ok",
      data: { token: "a/b", expiresAt: "x", url: "https://nour.example/?preview=tok" },
    });
    expect(await actions.previewUrlAction()).toEqual({
      status: "ok",
      url: "https://nour.example/?preview=tok",
      expiresAt: "x",
    });
    api.issuePreviewToken.mockResolvedValueOnce({
      outcome: "ok",
      data: { token: "a/b", expiresAt: "x", url: null },
    });
    expect(await actions.previewUrlAction()).toEqual({
      status: "ok",
      url: "https://shop.example/?preview=a%2Fb",
      expiresAt: "x",
    });
    vi.stubEnv("STOREFRONT_URL", "");
    api.issuePreviewToken.mockResolvedValueOnce({
      outcome: "ok",
      data: { token: "t", expiresAt: "x", url: null },
    });
    expect(await actions.previewUrlAction()).toEqual({ status: "error" });
  });

  it("preview url also says how long the token lives by the server's clock (M-4)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00.000Z"));
    api.issuePreviewToken.mockResolvedValueOnce({
      outcome: "ok",
      data: {
        token: "t",
        expiresAt: "2026-10-27T11:00:00.000Z",
        url: "https://n.example/?preview=t",
      },
    });
    expect(await actions.previewUrlAction()).toEqual({
      status: "ok",
      url: "https://n.example/?preview=t",
      expiresAt: "2026-10-27T11:00:00.000Z",
      expiresInMs: 60 * 60_000,
    });
    vi.useRealTimers();
  });
});

describe("section editor actions (Part 3)", () => {
  const image = { id: "m1", url: "https://c/a", alt: null, width: 1, height: 1 };

  it("lists the library page and passes the cursor on", async () => {
    const page = {
      items: [{ id: "m1", name: "a.png", image }],
      endCursor: "c2",
      hasNextPage: true,
    };
    media.fetchLibraryImages.mockResolvedValue({ outcome: "ok", data: page });
    expect(await actions.listLibraryImagesAction("c1")).toEqual({ status: "ok", ...page });
    expect(media.fetchLibraryImages).toHaveBeenLastCalledWith("c1");
    await actions.listLibraryImagesAction(null);
    expect(media.fetchLibraryImages).toHaveBeenLastCalledWith(null);
    media.fetchLibraryImages.mockResolvedValue({ outcome: "error", message: "x" });
    expect(await actions.listLibraryImagesAction(null)).toEqual({ status: "error" });
  });

  it("refuses a long or spaced cursor and a non-string one without a call", async () => {
    expect(await actions.listLibraryImagesAction("a".repeat(5000))).toEqual({ status: "error" });
    expect(await actions.listLibraryImagesAction("a b")).toEqual({ status: "error" });
    expect(await actions.listLibraryImagesAction(7 as never)).toEqual({ status: "error" });
    expect(media.fetchLibraryImages).not.toHaveBeenCalled();
  });

  it("a failing read is an error, not a throw", async () => {
    media.fetchLibraryImages.mockRejectedValue(new Error("boom"));
    expect(await actions.listLibraryImagesAction(null)).toEqual({ status: "error" });
  });

  it("alt: refuses a bad id or a non-string without a call; trims; blank is null", async () => {
    expect(await actions.updateImageAltAction("../x", "a")).toEqual({ status: "error" });
    expect(await actions.updateImageAltAction("m1", 7 as never)).toEqual({ status: "error" });
    expect(await actions.updateImageAltAction("m1", "a".repeat(301))).toEqual({ status: "error" });
    expect(media.updateMediaAlt).not.toHaveBeenCalled();
    media.updateMediaAlt.mockResolvedValue({ outcome: "ok", data: {} });
    expect(await actions.updateImageAltAction("m1", "  ")).toEqual({ status: "ok" });
    expect(media.updateMediaAlt).toHaveBeenLastCalledWith("m1", null, expect.any(String));
    await actions.updateImageAltAction("m1", "  Red shoe ");
    expect(media.updateMediaAlt).toHaveBeenLastCalledWith("m1", "Red shoe", expect.any(String));
    await actions.updateImageAltAction("m1", "a".repeat(300));
    expect(media.updateMediaAlt).toHaveBeenCalledTimes(3);
    const keys = media.updateMediaAlt.mock.calls.map((c) => c[2]);
    expect(new Set(keys).size).toBe(3);
  });

  it("alt: a failed patch is an error", async () => {
    media.updateMediaAlt.mockResolvedValue({ outcome: "forbidden", message: "x" });
    expect(await actions.updateImageAltAction("m1", "a")).toEqual({ status: "error" });
    media.updateMediaAlt.mockRejectedValue(new Error("boom"));
    expect(await actions.updateImageAltAction("m1", "a")).toEqual({ status: "error" });
  });

  it("draft save checks its arguments before any call", async () => {
    const bad = [
      { document: "x", expectedVersion: 1 },
      { document: [], expectedVersion: 1 },
      { document: null, expectedVersion: 1 },
      { document: {}, expectedVersion: -1 },
      { document: {}, expectedVersion: 1.5 },
    ];
    for (const input of bad) {
      expect(await actions.saveThemeDraftAction(input as never)).toEqual({ status: "error" });
    }
    expect(api.saveThemeDraft).not.toHaveBeenCalled();
  });
});
