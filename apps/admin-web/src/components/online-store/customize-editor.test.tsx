import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_THEME_DOCUMENT, type ThemeDocument } from "@platform/storefront-content";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  saveThemeDraftAction: vi.fn(),
  publishThemeAction: vi.fn(),
  previewUrlAction: vi.fn(),
  discardThemeDraftAction: vi.fn(),
  restoreReleaseAction: vi.fn(),
}));
vi.mock("@/app/online-store/themes/actions", () => actions);
vi.mock("@/app/online-store/actions", () => ({ uploadOnlineStoreImageAction: vi.fn() }));
const { CustomizeEditor } = await import("./customize-editor");

const state = {
  draft: DEFAULT_THEME_DOCUMENT,
  published: null,
  draftRevision: 1,
  draftSavedAt: null,
  publishedDraftRevision: null,
  releaseNumber: 0,
  publishedAt: null,
  publishedBy: null,
  hasUnpublishedChanges: true,
  images: {},
  version: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  actions.previewUrlAction.mockResolvedValue({
    status: "ok",
    url: "https://shop.example/?preview=tok",
    expiresAt: "x",
  });
  actions.saveThemeDraftAction.mockResolvedValue({
    status: "ok",
    draftRevision: 2,
    version: 2,
    warnings: [],
  });
});
afterEach(() => {
  // Unmount first: the editor saves a pending (or failed) change on unmount (F19), and that call
  // must land before the mocks are reset, not in the next test.
  cleanup();
  vi.useRealTimers();
  for (const fn of Object.values(actions)) fn.mockReset();
});

const renderEditor = (role: "operator" | "admin" = "admin", s: typeof state = state) =>
  render(<CustomizeEditor t={en} locale="en" state={s} role={role} storeName="Nour" />);

const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type SaveArg = { document: ThemeDocument; expectedVersion: number; idempotencyKey: string };
const saveArg = (call: number) => (actions.saveThemeDraftAction.mock.calls[call] as [SaveArg])[0];

const withBrand = (brand: Partial<ThemeDocument["brand"]>): ThemeDocument => ({
  ...DEFAULT_THEME_DOCUMENT,
  brand: { ...DEFAULT_THEME_DOCUMENT.brand, ...brand },
});

describe("CustomizeEditor", () => {
  it("autosaves 1 s after the last change with the current version, and reloads the preview", async () => {
    renderEditor();
    await tick();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.accent), {
      target: { value: "#ffcc00" },
    });
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    const arg = saveArg(0);
    expect(arg.expectedVersion).toBe(1);
    expect(arg.document.brand.colors.primary).toBe("#112233");
    expect(arg.document.brand.colors.accent).toBe("#ffcc00");
    expect(screen.getByText(en.onlineStoreCustomize.saved)).toBeInTheDocument();
    expect(screen.getByTitle(en.onlineStoreCustomize.previewTitle)).toHaveAttribute(
      "src",
      "https://shop.example/?preview=tok&v=2",
    );
  });

  it("a 409 shows the reload message (Decision 36)", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({ status: "conflict" });
    renderEditor();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    await tick(1000);
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.conflict);
  });

  it("unreadable body text is flagged, and Auto-fix picks black on a light background", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.foreground), {
      target: { value: "#f8fafc" },
    });
    expect(screen.getByText(en.onlineStoreCustomize.contrastBlocked)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: en.onlineStoreCustomize.autoFix })[0]!);
    expect(screen.getByLabelText(en.onlineStoreCustomize.colors.foreground)).toHaveValue("#000000");
  });

  it("a DRAFT_CHANGED publish shows the reload message (Review Focus 4)", async () => {
    actions.publishThemeAction.mockResolvedValue({ status: "draft_changed" });
    renderEditor("admin");
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.publish }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.confirmPublish }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.publishThemeAction).toHaveBeenCalledWith(1, expect.any(String));
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.draftChanged);
  });

  it("operators cannot publish", () => {
    renderEditor("operator");
    const publish = screen.getByRole("button", { name: en.onlineStoreCustomize.publish });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("title", en.onlineStoreThemes.adminOnlyPublish);
  });

  it("publish stops when the pending change fails to save (preflight F20)", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({ status: "error" });
    renderEditor("admin");
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.publish }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.confirmPublish }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    expect(actions.publishThemeAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.saveError);
  });

  it("publish after a successful flush sends the new revision", async () => {
    actions.publishThemeAction.mockResolvedValue({ status: "ok", releaseNumber: 1 });
    renderEditor("admin");
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.publish }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.confirmPublish }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.publishThemeAction).toHaveBeenCalledWith(2, expect.any(String));
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.published);
  });

  it("Retry resends the same payload with the same idempotency key (Ruling 2)", async () => {
    actions.saveThemeDraftAction.mockResolvedValueOnce({ status: "error" });
    renderEditor();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    await tick(1000);
    expect(screen.getByText(en.onlineStoreCustomize.saveError)).toBeInTheDocument();
    await tick(60_000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.retry }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(2);
    expect(saveArg(1).idempotencyKey).toBe(saveArg(0).idempotencyKey);
    expect(saveArg(1).expectedVersion).toBe(1);
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#445566" },
    });
    await tick(1000);
    expect(saveArg(2).expectedVersion).toBe(2);
    expect(saveArg(2).idempotencyKey).not.toBe(saveArg(0).idempotencyKey);
  });

  it("a missing logo shows the field error, can be cleared, and never loops (Ruling 3)", async () => {
    actions.saveThemeDraftAction.mockResolvedValueOnce({
      status: "invalid",
      fields: [{ field: "brand.logo.imageRef", message: "IMAGE_NOT_FOUND" }],
    });
    renderEditor("operator", {
      ...state,
      draft: withBrand({ logo: { imageRef: "archived-logo", widthPx: 140 } }),
    });
    expect(screen.getByText(en.onlineStorePreferences.imageNotFound)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    await tick(1000);
    await tick(60_000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en.onlineStorePreferences.imageNotFound)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.shareRemove }));
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(2);
    expect(saveArg(1).document.brand.logo.imageRef).toBeNull();
    expect(screen.queryByText(en.onlineStorePreferences.imageNotFound)).toBeNull();
  });

  it("other field codes get their own copy (INVALID_COLOR on a colour)", async () => {
    actions.saveThemeDraftAction.mockResolvedValueOnce({
      status: "invalid",
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    renderEditor();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    await tick(1000);
    expect(screen.getByText(en.onlineStoreErrors.invalidColor)).toBeInTheDocument();
  });

  it("social links: stored percent-encoding shows decoded; INVALID_URL and TOO_LONG get copy (Ruling 5)", async () => {
    const arabic = String.fromCharCode(0x0645, 0x0631, 0x0628, 0x062d);
    const stored = new URL(`https://www.facebook.com/${arabic}`).href;
    expect(stored).toContain("%D9%85");
    renderEditor("operator", { ...state, draft: withBrand({ social: { facebook: stored } }) });
    const facebook = screen.getByLabelText(en.onlineStoreCustomize.networks.facebook);
    expect(facebook).toHaveValue(decodeURI(stored));
    expect(screen.getByText(en.onlineStoreCustomize.socialHint)).toBeInTheDocument();

    const instagram = screen.getByLabelText(en.onlineStoreCustomize.networks.instagram);
    fireEvent.change(instagram, { target: { value: "http://instagram.com/nour" } });
    fireEvent.blur(instagram);
    expect(screen.getByText(en.onlineStoreCustomize.socialInvalid)).toBeInTheDocument();

    // 114 characters as typed, about 614 once each Arabic letter is percent-encoded.
    const long = `https://x.com/${String.fromCharCode(0x0645).repeat(100)}`;
    expect(long.length).toBeLessThan(500);
    const x = screen.getByLabelText(en.onlineStoreCustomize.networks.x);
    fireEvent.change(x, { target: { value: long } });
    fireEvent.blur(x);
    expect(screen.getByText(en.onlineStoreCustomize.socialTooLong)).toBeInTheDocument();
    await tick(1000);
    expect(actions.saveThemeDraftAction).not.toHaveBeenCalled();

    fireEvent.change(instagram, { target: { value: `https://instagram.com/${arabic}` } });
    fireEvent.blur(instagram);
    await tick(1000);
    expect(saveArg(0).document.brand.social.instagram).toBe(
      new URL(`https://instagram.com/${arabic}`).href,
    );
    expect(saveArg(0).document.brand.social.facebook).toBe(stored);
  });

  it("refreshes the preview token before its 60 minutes run out", async () => {
    actions.previewUrlAction.mockResolvedValue({
      status: "ok",
      url: "https://shop.example/?preview=tok",
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    renderEditor();
    await tick();
    expect(actions.previewUrlAction).toHaveBeenCalledTimes(1);
    await tick(50 * 60_000);
    expect(actions.previewUrlAction).toHaveBeenCalledTimes(2);
  });

  it("an expired preview is replaced by a reload control (Ruling 4)", async () => {
    actions.previewUrlAction.mockResolvedValueOnce({
      status: "ok",
      url: "https://shop.example/?preview=tok",
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    renderEditor();
    await tick();
    expect(screen.getByTitle(en.onlineStoreCustomize.previewTitle)).toBeInTheDocument();
    await tick(30_000);
    expect(screen.queryByTitle(en.onlineStoreCustomize.previewTitle)).toBeNull();
    expect(screen.getByText(en.onlineStoreCustomize.previewExpired)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.reloadPreview }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTitle(en.onlineStoreCustomize.previewTitle)).toHaveAttribute(
      "src",
      "https://shop.example/?preview=tok&v=1",
    );
  });

  it("leaving the editor saves a pending change (cleanup flushes, F19)", async () => {
    const { unmount } = renderEditor();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    unmount();
    await tick();
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
  });
});
