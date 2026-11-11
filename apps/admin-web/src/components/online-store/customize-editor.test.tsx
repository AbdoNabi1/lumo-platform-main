import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  DEFAULT_THEME_DOCUMENT,
  newSection,
  SECTION_FOCUS_MESSAGE,
  sectionHeading,
  type Section,
  type ThemeDocument,
} from "@platform/storefront-content";
import type { ThemeTargetsDto } from "@/lib/api/online-store";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  saveThemeDraftAction: vi.fn(),
  publishThemeAction: vi.fn(),
  previewUrlAction: vi.fn(),
  discardThemeDraftAction: vi.fn(),
  restoreReleaseAction: vi.fn(),
}));
vi.mock("@/app/online-store/themes/actions", () => ({
  ...actions,
  listLibraryImagesAction: vi.fn(),
  updateImageAltAction: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ searchLinkTargetsAction: vi.fn() }));
vi.mock("@/app/online-store/navigation/actions", () => navigation);
vi.mock("@/app/online-store/actions", () => ({ uploadOnlineStoreImageAction: vi.fn() }));
const { CustomizeEditor } = await import("./customize-editor");
const { LINK_SEARCH_DEBOUNCE_MS } = await import("./link-picker");

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
  targets: null as ThemeTargetsDto | null,
  version: 1,
};

beforeEach(() => {
  expect.hasAssertions();
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
afterEach(async () => {
  // Unmount first: the editor saves a pending (or failed) change on unmount (F19), and that call
  // must land before the mocks are reset, not in the next test. Its answer may arm a retry timer;
  // let that happen under the fake clock, which is dropped below. Armed after `useRealTimers` it
  // would be a real 2 s timer that fires inside a later test and calls its mock.
  cleanup();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  for (const fn of Object.values(actions)) fn.mockReset();
  navigation.searchLinkTargetsAction.mockReset();
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
      header: { sticky: false, menuHandle: "sale", announcement: null },
      footer: { ...DEFAULT_THEME_DOCUMENT.footer, menuHandle: "sale", showPolicyLinks: false },
    };
    renderEditor("admin", { ...state, draft });
    await tick();
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.showSocial));
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.stickyHeader));
    await tick(1000);
    const doc = saveArg(0).document;
    expect(doc.header).toEqual({ sticky: true, menuHandle: "sale", announcement: null });
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

// ---- Part 3: the section editor ------------------------------------------------------------

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SID1 = uuid(1);
const SID2 = uuid(2);
const richSection = (id: string, heading: string): Section => {
  const base = newSection("rich_text", id);
  return { ...base, settings: { ...base.settings, heading: { ar: heading, en: heading } } };
};
const stateWith = (
  sections: readonly Section[],
  extra: Partial<typeof state> = {},
): typeof state => ({
  ...state,
  draft: {
    ...DEFAULT_THEME_DOCUMENT,
    homepage: { ...DEFAULT_THEME_DOCUMENT.homepage, sections },
  },
  ...extra,
});
const rowButton = (title: string) =>
  screen
    .getAllByRole("button")
    .find(
      (b) => b.closest("[data-section-row]") && b.querySelector("bdi")?.textContent === title,
    ) as HTMLElement;
const PREVIEW_URL = "https://shop.example/?preview=tok";
const frame = () => screen.getByTitle(en.onlineStoreCustomize.previewTitle) as HTMLIFrameElement;
const spyPost = (el: HTMLIFrameElement) =>
  vi.spyOn(el.contentWindow as Window, "postMessage").mockImplementation(() => undefined);
const ready = (init: MessageEventInit) =>
  act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "morbeh:preview-ready" }, ...init }),
    );
    await vi.advanceTimersByTimeAsync(0);
  });
const focusMessage = (id: string) => ({ type: SECTION_FOCUS_MESSAGE, id });
const headingLabel = `${en.onlineStoreSections.fields.heading} (${en.onlineStorePreferences.english})`;
const hideButton = (name: string) =>
  screen.getByRole("button", { name: en.onlineStoreSections.hide.replace("{name}", name) });

describe("CustomizeEditor — the section editor (Part 3)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("has the Sections and Theme settings tabs, and the Theme tab still holds the Part 1 panels", async () => {
    renderEditor();
    await tick();
    const sectionsTab = screen.getByRole("tab", { name: en.onlineStoreSections.tabSections });
    const themeTab = screen.getByRole("tab", { name: en.onlineStoreSections.tabTheme });
    expect(sectionsTab).toHaveAttribute("data-state", "active");
    expect(
      screen.getByRole("heading", { name: en.onlineStoreSections.template }),
    ).toBeInTheDocument();
    const panel = () => document.getElementById(themeTab.getAttribute("aria-controls")!)!;
    expect(panel()).toHaveAttribute("data-state", "inactive");
    fireEvent.mouseDown(themeTab, { button: 0 });
    expect(panel()).toHaveAttribute("data-state", "active");
    for (const name of [
      en.onlineStoreCustomize.logoPanel,
      en.onlineStoreCustomize.colorsPanel,
      en.onlineStoreCustomize.typographyPanel,
      en.onlineStoreCustomize.cornersPanel,
      en.onlineStoreCustomize.socialPanel,
    ]) {
      expect(within(panel()).getByText(name)).toBeInTheDocument();
    }
    // The footer menu and note moved out of the Theme tab into the tree's Footer group.
    expect(within(panel()).queryByLabelText(en.onlineStoreCustomize.footerMenu)).toBeNull();
  });

  it("focus posts to the preview origin, again after each reload (Review Focus 3)", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A"), richSection(SID2, "B")]));
    await tick();
    const first = frame();
    const post = spyPost(first);
    fireEvent.click(rowButton("A"));
    expect(post).toHaveBeenCalledWith(focusMessage(SID1), "https://shop.example");
    post.mockClear();
    fireEvent.load(first);
    expect(post).toHaveBeenCalledWith(focusMessage(SID1), "https://shop.example");
    expect(post.mock.calls.every((call) => (call as unknown[])[1] !== "*")).toBe(true);

    // A save reloads the frame (a new element): its load posts the selection again.
    fireEvent.click(hideButton("A"));
    await tick(1000);
    const second = frame();
    expect(second).not.toBe(first);
    const next = spyPost(second);
    fireEvent.load(second);
    expect(next).toHaveBeenCalledWith(focusMessage(SID1), "https://shop.example");
  });

  it("nothing is posted on load while no section is selected", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    const post = spyPost(frame());
    fireEvent.load(frame());
    expect(post).not.toHaveBeenCalled();
  });

  it("a ready message from the frame itself, at the preview origin, posts the selection (F3)", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    const el = frame();
    const post = spyPost(el);
    fireEvent.click(rowButton("A"));
    post.mockClear();
    await ready({ origin: "https://shop.example", source: el.contentWindow });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(focusMessage(SID1), "https://shop.example");
  });

  it("a ready message from another origin, or from another window, posts nothing (F3)", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    const el = frame();
    const post = spyPost(el);
    fireEvent.click(rowButton("A"));
    post.mockClear();
    await ready({ origin: "https://evil.example", source: el.contentWindow });
    await ready({ origin: "https://shop.example", source: window });
    await ready({ origin: "https://shop.example", source: null });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "something-else" },
        origin: "https://shop.example",
        source: el.contentWindow,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", { data: "morbeh:preview-ready", origin: "https://shop.example" }),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("a ready message with nothing selected posts nothing, and the listener goes on unmount (F3)", async () => {
    const { unmount } = renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    const el = frame();
    const post = spyPost(el);
    await ready({ origin: "https://shop.example", source: el.contentWindow });
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(rowButton("A"));
    post.mockClear();
    const remove = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(remove.mock.calls.some(([type]) => type === "message")).toBe(true);
    await ready({ origin: "https://shop.example", source: el.contentWindow });
    expect(post).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  it("adding a section autosaves the draft with it, and the second save carries the first save's version", async () => {
    actions.saveThemeDraftAction.mockResolvedValueOnce({
      status: "ok",
      version: 9,
      draftRevision: 4,
      warnings: [],
    });
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreSections.addSection }));
    const hero = screen.getByRole("dialog").querySelector('button[data-section-type="hero"]')!;
    fireEvent.click(hero);
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    expect(saveArg(0).expectedVersion).toBe(1);
    const types = saveArg(0).document.homepage.sections.map((section) => section.type);
    expect(types).toEqual(["rich_text", "hero"]);
    expect(frame()).toHaveAttribute("src", `${PREVIEW_URL}&v=4`);

    // The new hero is selected; hide it from the tree (the eye toggle of the second row).
    const heroTitle = sectionHeading(saveArg(0).document.homepage.sections[1]!, "en")!;
    fireEvent.click(hideButton(heroTitle));
    await tick(1000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(2);
    expect(saveArg(1).expectedVersion).toBe(9);
    expect(saveArg(1).document.homepage.sections[1]!.hidden).toBe(true);
    expect(saveArg(1).idempotencyKey).not.toBe(saveArg(0).idempotencyKey);
  });

  it("selecting a section opens its settings form with the generated fields", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    fireEvent.click(rowButton("A"));
    expect(screen.getByRole("button", { name: en.onlineStoreSections.back })).toBeInTheDocument();
    expect(screen.getByLabelText(headingLabel)).toHaveValue("A");
  });

  it("an edit in the form autosaves the section's settings", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    fireEvent.click(rowButton("A"));
    fireEvent.change(screen.getByLabelText(headingLabel), { target: { value: "Our story" } });
    await tick(1000);
    const section = saveArg(0).document.homepage.sections[0]!;
    expect(JSON.stringify(section.settings)).toContain("Our story");
    expect(section.id).toBe(SID1);
  });

  it("Back to sections shows the tree again and returns focus to the row", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    fireEvent.click(rowButton("A"));
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreSections.back }));
    expect(screen.queryByRole("button", { name: en.onlineStoreSections.back })).toBeNull();
    expect(document.activeElement).toBe(rowButton("A"));
  });

  it("an unsupported section is named and has no settings form", async () => {
    const future = { id: SID2, type: "countdown_timer", hidden: false, settings: { x: 1 } };
    renderEditor("operator", stateWith([richSection(SID1, "A"), future]));
    await tick();
    fireEvent.click(rowButton(en.onlineStoreSections.unsupported));
    expect(screen.getByText(en.onlineStoreSections.unsupportedBody)).toBeInTheDocument();
    expect(screen.queryByLabelText(headingLabel)).toBeNull();
  });

  it("an invalid save puts the copy on the collection field and the dot on its row", async () => {
    const collection = newSection("featured_collection", SID1);
    const picked = {
      ...collection,
      settings: { ...collection.settings, collection: uuid(50) },
    } as unknown as Section;
    actions.saveThemeDraftAction.mockResolvedValueOnce({
      status: "invalid",
      fields: [{ field: "homepage.sections.0.settings.collection", message: "TARGET_NOT_FOUND" }],
    });
    const targets = {
      collection: { [uuid(50)]: { title: "Sale", live: true } },
      product: {},
      page: {},
    };
    renderEditor("operator", stateWith([picked], { targets }));
    await tick();
    expect(screen.queryByRole("img", { name: en.onlineStoreSections.hasProblem })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Hide / }));
    await tick(1000);
    expect(
      screen.getByRole("img", { name: en.onlineStoreSections.hasProblem }),
    ).toBeInTheDocument();
    fireEvent.click(rowButton("Featured collection"));
    expect(screen.getByText(en.onlineStoreSections.errors.targetNotFound)).toBeInTheDocument();
  });

  it("a removed collection flags its row, and picking a collection shows no problem dot (F4)", async () => {
    navigation.searchLinkTargetsAction.mockResolvedValue([
      { id: uuid(60), title: "Summer", subtitle: "/collections/summer" },
    ]);
    const collection = newSection("featured_collection", SID1);
    const removed = {
      ...collection,
      settings: { ...collection.settings, collection: uuid(61) },
    } as unknown as Section;
    const empty = { collection: {}, product: {}, page: {} };
    renderEditor("operator", stateWith([removed], { targets: empty }));
    await tick();
    expect(
      screen.getByRole("img", { name: en.onlineStoreSections.hasProblem }),
    ).toBeInTheDocument();
    fireEvent.click(rowButton("Featured collection"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sum" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: /Summer/ }));
    // The pick replaced the removed reference and is merged as live: no dot.
    expect(screen.queryByRole("img", { name: en.onlineStoreSections.hasProblem })).toBeNull();
  });

  it("loaded targets null stay null for the flags: a pick shows no removed dot anywhere (F4 fix)", async () => {
    navigation.searchLinkTargetsAction.mockResolvedValue([
      { id: uuid(60), title: "Summer", subtitle: "/collections/summer" },
    ]);
    const collection = newSection("featured_collection", SID1);
    const other = {
      ...collection,
      id: SID2,
      settings: { ...collection.settings, collection: uuid(61) },
    } as unknown as Section;
    renderEditor("operator", stateWith([collection, other], { targets: null }));
    await tick();
    expect(screen.queryByRole("img", { name: en.onlineStoreSections.hasProblem })).toBeNull();
    fireEvent.click(rowButton("Featured collection"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sum" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: /Summer/ }));
    // The other section's reference is not known to be removed just because something was picked.
    expect(screen.queryByRole("img", { name: en.onlineStoreSections.hasProblem })).toBeNull();
  });

  it("a loaded map plus a pick: the picked target is live, the others keep their state", async () => {
    navigation.searchLinkTargetsAction.mockResolvedValue([
      { id: uuid(60), title: "Summer", subtitle: "/collections/summer" },
    ]);
    const collection = newSection("featured_collection", SID1);
    const gone = {
      ...collection,
      id: SID2,
      settings: { ...collection.settings, collection: uuid(61) },
    } as unknown as Section;
    const loaded = { collection: {}, product: {}, page: {} };
    renderEditor("operator", stateWith([collection, gone], { targets: loaded }));
    await tick();
    const dots = () => screen.queryAllByRole("img", { name: en.onlineStoreSections.hasProblem });
    expect(dots()).toHaveLength(1); // only the removed one
    fireEvent.click(rowButton("Featured collection"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sum" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: /Summer/ }));
    expect(dots()).toHaveLength(1); // the picked one is live; the removed one still flagged
  });

  it("a duplicate below xl moves focus to the copy's form heading (the tree is hidden)", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    fireEvent.click(rowButton("A"));
    fireEvent.keyDown(screen.getByRole("button", { name: /^More actions for A$/ }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: en.onlineStoreSections.duplicate }));
    await tick(10);
    const heading = screen.getByRole("heading", { level: 3, name: "A" });
    expect(document.activeElement).toBe(heading);
    expect(document.querySelectorAll("[data-section-row]")).toHaveLength(2);
  });

  it("a 409 on a section edit stops autosave and shows the reload alert", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({ status: "conflict" });
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    fireEvent.click(hideButton("A"));
    await tick(1000);
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.conflict);
    expect(
      screen.getByRole("button", { name: en.onlineStoreSections.show.replace("{name}", "A") }),
    ).toBeDisabled();
    await tick(5000);
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
  });

  it("beforeunload is prevented while a section edit is unsaved", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    fireEvent.click(hideButton("A"));
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await tick(1000);
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("Publish stays disabled for an operator with the admin-only title", async () => {
    renderEditor("operator", stateWith([richSection(SID1, "A")]));
    await tick();
    const publish = screen.getByRole("button", { name: en.onlineStoreCustomize.publish });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("title", en.onlineStoreThemes.adminOnlyPublish);
  });

  it("the Header and Footer groups write the header and footer settings (the Part 2 cases)", async () => {
    renderEditor();
    await tick();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.headerMenu), {
      target: { value: "sale" },
    });
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.stickyHeader));
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.footerMenu), {
      target: { value: "main-menu" },
    });
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.showPolicyLinks));
    fireEvent.click(screen.getByLabelText(en.onlineStoreCustomize.showSocial));
    await tick(1000);
    const doc = saveArg(0).document;
    expect(doc.header).toEqual({
      ...DEFAULT_THEME_DOCUMENT.header,
      menuHandle: "sale",
      sticky: !DEFAULT_THEME_DOCUMENT.header.sticky,
    });
    expect(doc.footer).toEqual({
      ...DEFAULT_THEME_DOCUMENT.footer,
      menuHandle: "main-menu",
      showPolicyLinks: !DEFAULT_THEME_DOCUMENT.footer.showPolicyLinks,
      showSocial: !DEFAULT_THEME_DOCUMENT.footer.showSocial,
    });
  });

  it("the footer note is written under footer.note", async () => {
    renderEditor();
    await tick();
    const notes = screen.getAllByLabelText(new RegExp(en.onlineStoreCustomize.footerNote));
    fireEvent.change(notes[0] as HTMLTextAreaElement, { target: { value: "Thank you" } });
    await tick(1000);
    expect(JSON.stringify(saveArg(0).document.footer.note)).toContain("Thank you");
  });
});
