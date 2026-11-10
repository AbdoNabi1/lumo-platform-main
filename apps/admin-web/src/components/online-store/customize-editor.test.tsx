import { StrictMode } from "react";
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

const menus = [
  { handle: "main-menu", title: "Main menu" },
  { handle: "footer", title: "Footer menu" },
  { handle: "sale", title: "Sale" },
];

const renderEditor = (role: "operator" | "admin" = "admin", s: typeof state = state) =>
  render(
    <CustomizeEditor t={en} locale="en" state={s} role={role} storeName="Nour" menus={menus} />,
  );

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

  it("a social link typed without leaving the field is autosaved and counts as unsaved (final review M-4)", async () => {
    renderEditor("operator");
    const instagram = screen.getByLabelText(en.onlineStoreCustomize.networks.instagram);
    fireEvent.change(instagram, { target: { value: "https://instagram.com/nour" } });
    // No blur: closing the tab right now must ask for confirmation.
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await tick(1000);
    expect(saveArg(0).document.brand.social.instagram).toBe("https://instagram.com/nour");
  });

  it("an invalid social link is reported on blur only, never while typing, and never saved", async () => {
    renderEditor("operator");
    const instagram = screen.getByLabelText(en.onlineStoreCustomize.networks.instagram);
    fireEvent.change(instagram, { target: { value: "http://instagram.com/nour" } });
    expect(screen.queryByText(en.onlineStoreCustomize.socialInvalid)).not.toBeInTheDocument();
    await tick(1000);
    expect(actions.saveThemeDraftAction).not.toHaveBeenCalled();
    fireEvent.blur(instagram);
    expect(screen.getByText(en.onlineStoreCustomize.socialInvalid)).toBeInTheDocument();
    // Fixing it clears the message as soon as the text is valid, and saves.
    fireEvent.change(instagram, { target: { value: "https://instagram.com/nour" } });
    expect(screen.queryByText(en.onlineStoreCustomize.socialInvalid)).not.toBeInTheDocument();
    await tick(1000);
    expect(saveArg(0).document.brand.social.instagram).toBe("https://instagram.com/nour");
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
  const changePrimary = (value: string) =>
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value },
    });
  const confirmPublish = async () => {
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.publish }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.confirmPublish }));
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  it("a lost response then a new edit: replays the lost save, then saves the edit on v2 (I-1)", async () => {
    // A fake Runtime: the first request commits but its answer is lost on the way back.
    let version = 1;
    const answers = new Map<string, unknown>();
    let lose = true;
    actions.saveThemeDraftAction.mockImplementation((arg: SaveArg) => {
      const cached = answers.get(arg.idempotencyKey);
      if (cached !== undefined) return Promise.resolve(cached);
      let answer: unknown = { status: "conflict" };
      if (arg.expectedVersion === version) {
        version += 1;
        answer = { status: "ok", draftRevision: version, version, warnings: [] };
      }
      answers.set(arg.idempotencyKey, answer);
      if (lose) {
        lose = false;
        return Promise.resolve({ status: "error" });
      }
      return Promise.resolve(answer);
    });
    renderEditor();
    changePrimary("#112233");
    await tick(1000);
    expect(screen.getByText(en.onlineStoreCustomize.saveError)).toBeInTheDocument();
    changePrimary("#445566");
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(3);
    expect(saveArg(1).idempotencyKey).toBe(saveArg(0).idempotencyKey);
    expect(saveArg(2).expectedVersion).toBe(2);
    expect(saveArg(2).document.brand.colors.primary).toBe("#445566");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(en.onlineStoreCustomize.saved)).toBeInTheDocument();
    expect(version).toBe(3);
  });

  it("a transient failure retries on its own with backoff (I-2)", async () => {
    actions.saveThemeDraftAction.mockResolvedValueOnce({ status: "error" });
    renderEditor();
    changePrimary("#112233");
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    await tick(2000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(2);
    expect(saveArg(1).idempotencyKey).toBe(saveArg(0).idempotencyKey);
    expect(screen.getByText(en.onlineStoreCustomize.saved)).toBeInTheDocument();
  });

  it("unsaved edits block unload, and hiding or leaving the page saves them now (I-2)", async () => {
    renderEditor();
    const idle = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    changePrimary("#112233");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    visibility.mockRestore();
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);

    changePrimary("#445566");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(2);
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("a refused save keeps blocking unload until it is saved (I-2)", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({
      status: "invalid",
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    renderEditor();
    changePrimary("#112233");
    await tick(1000);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("a change made while a save is in flight is sent next on the new version (M-7)", async () => {
    let release!: (v: unknown) => void;
    actions.saveThemeDraftAction.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    renderEditor();
    changePrimary("#112233");
    await tick(1000);
    changePrimary("#445566");
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ status: "ok", draftRevision: 2, version: 2, warnings: [] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(2);
    expect(saveArg(1).expectedVersion).toBe(2);
    expect(saveArg(1).document.brand.colors.primary).toBe("#445566");
  });

  it("after a conflict the panels lock, later edits send nothing, and Reload is offered (M-2, M-7)", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({ status: "conflict" });
    renderEditor();
    changePrimary("#112233");
    await tick(1000);
    expect(screen.getByLabelText(en.onlineStoreCustomize.colors.primary)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: en.onlineStoreCustomize.reload }),
    ).toBeInTheDocument();
    changePrimary("#445566");
    await tick(5000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
  });

  it("publish stops when the flush ends in a conflict (M-7)", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({ status: "conflict" });
    renderEditor("admin");
    changePrimary("#112233");
    await confirmPublish();
    expect(actions.publishThemeAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.conflict);
  });

  it("publish waits while a social link is invalid (M-6)", async () => {
    renderEditor("admin");
    const instagram = screen.getByLabelText(en.onlineStoreCustomize.networks.instagram);
    fireEvent.change(instagram, { target: { value: "http://instagram.com/nour" } });
    fireEvent.blur(instagram);
    await confirmPublish();
    expect(actions.publishThemeAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.fixFieldsFirst);
    fireEvent.change(instagram, { target: { value: "" } });
    fireEvent.blur(instagram);
    actions.publishThemeAction.mockResolvedValue({ status: "ok", releaseNumber: 1 });
    await confirmPublish();
    expect(actions.publishThemeAction).toHaveBeenCalledTimes(1);
  });

  it("autosave still works under React Strict Mode (F19)", async () => {
    const admin = "admin" as const; // a literal role prop reads as an ARIA role to jsx-a11y
    render(
      <StrictMode>
        <CustomizeEditor
          t={en}
          locale="en"
          state={state}
          role={admin}
          storeName="Nour"
          menus={menus}
        />
      </StrictMode>,
    );
    await tick();
    changePrimary("#112233");
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en.onlineStoreCustomize.saved)).toBeInTheDocument();
  });

  it("a skewed clock (token already expired here) does not mint a token on every focus (M-4)", async () => {
    actions.previewUrlAction.mockResolvedValue({
      status: "ok",
      url: "https://shop.example/?preview=tok",
      expiresAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    });
    renderEditor();
    await tick();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.previewUrlAction).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle(en.onlineStoreCustomize.previewTitle)).toBeInTheDocument();
  });

  it("the preview frame is sandboxed without top navigation (M-1)", async () => {
    renderEditor();
    await tick();
    const frame = screen.getByTitle(en.onlineStoreCustomize.previewTitle);
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
  });

  it("a save that never answers times out; a later edit saves and publish does not hang (round 2)", async () => {
    actions.saveThemeDraftAction.mockImplementationOnce(() => new Promise(() => undefined));
    actions.publishThemeAction.mockResolvedValue({ status: "ok", releaseNumber: 1 });
    renderEditor("admin");
    changePrimary("#112233");
    await tick(1000);
    expect(screen.getByText(en.onlineStoreCustomize.saving)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.publish }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.confirmPublish }));
      await vi.advanceTimersByTimeAsync(25_000);
    });
    // The stuck request timed out, its key was replayed (and answered), then publish went out.
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(2);
    expect(saveArg(1).idempotencyKey).toBe(saveArg(0).idempotencyKey);
    expect(actions.publishThemeAction).toHaveBeenCalledWith(2, expect.any(String));
    changePrimary("#445566");
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(3);
    expect(saveArg(2).expectedVersion).toBe(2);
    expect(screen.getByText(en.onlineStoreCustomize.saved)).toBeInTheDocument();
  });

  it("hiding the page never resends a draft the server refused (round 2)", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({
      status: "invalid",
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    renderEditor();
    changePrimary("#112233");
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
    });
    visibility.mockRestore();
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
  });

  it("the token deadline follows the server's lifetime, not this browser's clock (M-4)", async () => {
    actions.previewUrlAction.mockResolvedValueOnce({
      status: "ok",
      url: "https://shop.example/?preview=tok",
      // This browser's clock is 3 hours behind: expiresAt alone would look valid for an hour.
      expiresAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
      expiresInMs: 30_000,
    });
    renderEditor();
    await tick();
    await tick(30_000);
    expect(screen.getByText(en.onlineStoreCustomize.previewExpired)).toBeInTheDocument();
  });

  it("the header and footer menu selects list the shop's menus and write menuHandle; Show policy links writes showPolicyLinks", async () => {
    renderEditor();
    await tick();
    const header = screen.getByLabelText(en.onlineStoreCustomize.headerMenu);
    const footer = screen.getByLabelText(en.onlineStoreCustomize.footerMenu);
    const options = (select: HTMLElement) =>
      Array.from(select.querySelectorAll("option")).map((o) => [o.value, o.textContent]);
    expect(options(header)).toEqual([
      ["main-menu", "Main menu"],
      ["footer", "Footer menu"],
      ["sale", "Sale"],
    ]);
    expect(header).toHaveValue("main-menu");
    expect(footer).toHaveValue("footer");
    fireEvent.change(header, { target: { value: "sale" } });
    fireEvent.change(footer, { target: { value: "main-menu" } });
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.showPolicyLinks));
    await tick(1000);
    const doc = saveArg(0).document;
    expect(doc.header).toEqual({ ...DEFAULT_THEME_DOCUMENT.header, menuHandle: "sale" });
    expect(doc.footer).toEqual({
      ...DEFAULT_THEME_DOCUMENT.footer,
      menuHandle: "main-menu",
      showPolicyLinks: false,
    });
  });

  it("saving an unrelated header or footer field keeps menuHandle and showPolicyLinks", async () => {
    const draft: ThemeDocument = {
      ...DEFAULT_THEME_DOCUMENT,
      header: { sticky: false, menuHandle: "sale" },
      footer: { ...DEFAULT_THEME_DOCUMENT.footer, menuHandle: "sale", showPolicyLinks: false },
    };
    renderEditor("admin", { ...state, draft });
    await tick();
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.showSocial));
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.stickyHeader));
    await tick(1000);
    const doc = saveArg(0).document;
    expect(doc.header).toEqual({ sticky: true, menuHandle: "sale" });
    expect(doc.footer).toEqual({
      ...DEFAULT_THEME_DOCUMENT.footer,
      showSocial: false,
      menuHandle: "sale",
      showPolicyLinks: false,
    });
  });

  it("a chosen menu missing from the list (deleted, or the list failed) stays selectable", async () => {
    const draft: ThemeDocument = {
      ...DEFAULT_THEME_DOCUMENT,
      footer: { ...DEFAULT_THEME_DOCUMENT.footer, menuHandle: "old-links" },
    };
    renderEditor("admin", { ...state, draft });
    await tick();
    const footer = screen.getByLabelText(en.onlineStoreCustomize.footerMenu);
    expect(footer).toHaveValue("old-links");
    expect(Array.from(footer.querySelectorAll("option")).map((o) => o.value)).toEqual([
      "main-menu",
      "footer",
      "sale",
      "old-links",
    ]);
  });
});
