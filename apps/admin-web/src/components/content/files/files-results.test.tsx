import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MediaFileDto } from "@/lib/api/media";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const api = vi.hoisted(() => ({ fetchMediaFilesPage: vi.fn() }));
vi.mock("@/lib/api/media", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/content/files",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/content/files/actions", () => ({
  uploadFileAction: vi.fn(),
  updateFileAltAction: vi.fn(),
  getFileDownloadUrlAction: vi.fn(),
  archiveFileAction: vi.fn(),
}));
vi.mock("@/lib/media/prepare-image", () => ({ prepareImage: vi.fn() }));

const { FilesResults } = await import("./files-results");

const file = (id: string, name: string): MediaFileDto => ({
  id,
  name,
  status: "active",
  contentType: "image/png",
  byteSize: 2048,
  createdAt: "2026-11-24T10:00:00.000Z",
  image: { url: `https://cdn.test/${id}.webp`, alt: null, width: 1, height: 1 },
});

const okPage = (items: MediaFileDto[], hasNextPage = false) => ({
  outcome: "ok",
  data: { items, pageInfo: { hasNextPage, endCursor: hasNextPage ? "c1" : null } },
});

type Props = Partial<{
  q: string;
  sort: "newest" | "oldest";
  view: "grid" | "list";
  after: string;
  canEdit: boolean;
  t: Dictionary;
}>;

/** Calls the async server component as a function, then renders what it returned. */
async function renderResults(props: Props = {}) {
  const t = props.t ?? en;
  render(
    await FilesResults({
      q: props.q ?? "",
      sort: props.sort ?? "newest",
      view: props.view ?? "grid",
      after: props.after,
      canEdit: props.canEdit ?? true,
      t,
      locale: t === ar ? "ar" : "en",
    }),
  );
}

beforeEach(() => {
  expect.hasAssertions();
  api.fetchMediaFilesPage.mockReset();
});

describe("FilesResults", () => {
  it("asks for 50 newest-first and draws the grid", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([file("m-1", "Beach.png")]));

    await renderResults();

    expect(api.fetchMediaFilesPage).toHaveBeenCalledWith({ first: 50, sort: "newest" });
    expect(screen.getByRole("list", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Beach\.png/ })).toBeInTheDocument();
  });

  it("passes search, sort and the cursor, and draws the table for the list view", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([file("m-1", "Beach.png")]));

    await renderResults({ q: "beach", sort: "oldest", view: "list", after: "c9" });

    expect(api.fetchMediaFilesPage).toHaveBeenCalledWith({
      first: 50,
      after: "c9",
      search: "beach",
      sort: "oldest",
    });
    expect(screen.getByRole("table", { name: "Files" })).toBeInTheDocument();
  });

  it("offers Next when the API says there is another page", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([file("m-1", "Beach.png")], true));

    await renderResults({ canEdit: false });

    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });

  it("an operator's empty library invites an upload", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

    await renderResults({ canEdit: true });

    expect(
      screen.getByRole("heading", { name: "Upload and manage your files" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload files" })).toBeInTheDocument();
  });

  it("a viewer's empty library has no Upload button and no upload invitation", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

    await renderResults({ canEdit: false });

    expect(screen.getByText(en.files.emptyViewerBody)).toBeInTheDocument();
    expect(screen.queryByText("Upload and manage your files")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });

  it("a search with no hits says so instead of showing the empty-library state", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

    await renderResults({ q: "zzz" });

    expect(screen.getByText(en.files.noMatches)).toBeInTheDocument();
    expect(screen.queryByText("Upload and manage your files")).toBeNull();
  });

  it("shows the sign-in state when unauthorized", async () => {
    api.fetchMediaFilesPage.mockResolvedValue({ outcome: "unauthorized" });

    await renderResults();

    expect(screen.getByText(en.files.unauthorized)).toBeInTheDocument();
  });

  it.each([{ outcome: "error", message: "boom" }, { outcome: "not_found" }])(
    "shows the load error for %j",
    async (outcome) => {
      api.fetchMediaFilesPage.mockResolvedValue(outcome);

      await renderResults();

      expect(screen.getByText(en.files.error)).toBeInTheDocument();
      expect(screen.queryByRole("list")).toBeNull();
    },
  );

  it("renders Arabic copy", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

    await renderResults({ t: ar, canEdit: true });

    expect(screen.getByRole("heading", { name: ar.files.emptyTitle })).toBeInTheDocument();
  });
});
