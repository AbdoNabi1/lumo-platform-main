import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  publishThemeAction: vi.fn(),
  previewUrlAction: vi.fn(),
  restoreReleaseAction: vi.fn(),
  discardThemeDraftAction: vi.fn(),
}));
vi.mock("@/app/online-store/themes/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { ThemeCard } = await import("./theme-card");
type StaffRole = "viewer" | "operator" | "admin";
// Passed through variables: jsx-a11y reads a literal `role` prop as an ARIA role.
const viewer: StaffRole = "viewer";
const operator: StaffRole = "operator";
const admin: StaffRole = "admin";

const state = {
  draft: DEFAULT_THEME_DOCUMENT,
  published: null,
  draftRevision: 2,
  draftSavedAt: null,
  publishedDraftRevision: 1,
  releaseNumber: 1,
  publishedAt: "2026-10-20T09:00:00.000Z",
  publishedBy: "staff-1",
  hasUnpublishedChanges: true,
  images: {},
  version: 3,
};

describe("ThemeCard (spec 1.11)", () => {
  it("shows the current theme, the unpublished badge and Customize for operators", () => {
    render(<ThemeCard t={en} locale="en" state={state} role={operator} />);
    expect(screen.getByText("Morbeh Classic")).toBeInTheDocument();
    expect(screen.getByText(en.onlineStoreThemes.unpublishedChanges)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.onlineStoreThemes.customize })).toHaveAttribute(
      "href",
      "/online-store/themes/customize",
    );
  });

  it("Publish is disabled with the admin-only tooltip for operators and enabled for admins", () => {
    const { rerender } = render(<ThemeCard t={en} locale="en" state={state} role={operator} />);
    const publish = screen.getByRole("button", { name: en.onlineStoreThemes.publish });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("title", en.onlineStoreThemes.adminOnlyPublish);
    rerender(<ThemeCard t={en} locale="en" state={state} role={admin} />);
    expect(screen.getByRole("button", { name: en.onlineStoreThemes.publish })).toBeEnabled();
  });

  it("hides Publish when there is nothing to publish, and Customize for viewers", () => {
    render(
      <ThemeCard
        t={en}
        locale="en"
        state={{ ...state, hasUnpublishedChanges: false }}
        role={viewer}
      />,
    );
    expect(screen.queryByRole("button", { name: en.onlineStoreThemes.publish })).toBeNull();
    expect(screen.queryByRole("link", { name: en.onlineStoreThemes.customize })).toBeNull();
  });

  it("publishes the revision on the page, and a lost race reads as draft changed", async () => {
    actions.publishThemeAction.mockResolvedValueOnce({ status: "draft_changed" });
    render(<ThemeCard t={en} locale="en" state={state} role={admin} />);
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreThemes.publish }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreThemes.confirmPublish }));
    });
    expect(actions.publishThemeAction).toHaveBeenCalledWith(2, expect.any(String));
    expect(screen.getByRole("status")).toHaveTextContent(en.onlineStoreCustomize.draftChanged);
  });

  it("discard is offered to editors with unpublished changes, never to viewers", async () => {
    actions.discardThemeDraftAction.mockResolvedValueOnce({
      status: "ok",
      draftRevision: 3,
      version: 4,
    });
    const { unmount } = render(<ThemeCard t={en} locale="en" state={state} role={operator} />);
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreThemes.discard }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreThemes.confirmDiscard }));
    });
    expect(actions.discardThemeDraftAction).toHaveBeenCalledWith(3);
    expect(screen.getByRole("status")).toHaveTextContent(en.onlineStoreThemes.discarded);
    unmount();
    render(<ThemeCard t={en} locale="en" state={state} role={viewer} />);
    expect(screen.queryByRole("button", { name: en.onlineStoreThemes.discard })).toBeNull();
  });
});
