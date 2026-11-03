import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  saveThemeDraft: vi.fn(),
  publishTheme: vi.fn(),
  discardThemeDraft: vi.fn(),
  restoreThemeRelease: vi.fn(),
  issuePreviewToken: vi.fn(),
}));
const side = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/online-store", () => api);
vi.mock("@/lib/storefront-revalidate", () => ({ revalidateStorefront: side.revalidateStorefront }));
vi.mock("next/cache", () => ({ revalidatePath: side.revalidatePath }));
const actions = await import("./actions");

const KEY = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
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

  it("draft save reuses the caller's key, and replaces a malformed one (Ruling 2)", async () => {
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
      idempotencyKey: "bad key\n",
    });
    const [, , key] = api.saveThemeDraft.mock.lastCall as [unknown, number, string];
    expect(key).not.toBe("bad key\n");
    expect(key).toMatch(/^[A-Za-z0-9-]{16,100}$/);
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
});
