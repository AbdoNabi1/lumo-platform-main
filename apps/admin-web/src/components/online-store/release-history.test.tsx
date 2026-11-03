import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({ restoreReleaseAction: vi.fn() }));
vi.mock("@/app/online-store/themes/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { ReleaseHistory } = await import("./release-history");

const releases = [
  { releaseNumber: 2, publishedAt: "2026-10-21T09:00:00.000Z", publishedByName: null },
  { releaseNumber: 1, publishedAt: "2026-10-20T09:00:00.000Z", publishedByName: null },
];

describe("ReleaseHistory (restore goes to the draft, admin only)", () => {
  it("non-admins see Restore disabled with the reason", () => {
    render(<ReleaseHistory t={en} locale="en" releases={releases} version={4} isAdmin={false} />);
    for (const button of screen.getAllByRole("button", { name: en.onlineStoreThemes.restore })) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", en.onlineStoreThemes.adminOnlyRestore);
    }
  });

  it("admins restore into the draft with the current version; a missing release says so", async () => {
    actions.restoreReleaseAction.mockResolvedValueOnce({ status: "not_found" });
    render(<ReleaseHistory t={en} locale="en" releases={releases} version={4} isAdmin />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: en.onlineStoreThemes.restore })[1]!);
    });
    expect(actions.restoreReleaseAction).toHaveBeenCalledWith(1, 4);
    expect(screen.getByRole("status")).toHaveTextContent(en.onlineStoreThemes.releaseNotFound);
  });

  it("shows the empty state", () => {
    render(<ReleaseHistory t={en} locale="en" releases={[]} version={4} isAdmin />);
    expect(screen.getByText(en.onlineStoreThemes.noReleases)).toBeInTheDocument();
  });
});
