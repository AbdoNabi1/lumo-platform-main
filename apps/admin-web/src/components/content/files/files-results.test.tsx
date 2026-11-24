import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MediaFileDto } from "@/lib/api/media";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const api = vi.hoisted(() => ({ fetchMediaFilesPage: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), query: "" }));
const actions = vi.hoisted(() => ({
  uploadFileAction: vi.fn(),
  updateFileAltAction: vi.fn(),
  getFileDownloadUrlAction: vi.fn(),
  archiveFileAction: vi.fn(),
}));
vi.mock("@/lib/api/media", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/content/files",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/app/content/files/actions", () => actions);
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
async function resultsElement(props: Props = {}) {
  const t = props.t ?? en;
  return await FilesResults({
    q: props.q ?? "",
    sort: props.sort ?? "newest",
    view: props.view ?? "grid",
    after: props.after,
    canEdit: props.canEdit ?? true,
    t,
    locale: t === ar ? "ar" : "en",
  });
}

async function renderResults(props: Props = {}) {
  return render(await resultsElement(props));
}

beforeEach(() => {
  expect.hasAssertions();
  api.fetchMediaFilesPage.mockReset();
  nav.push.mockReset();
  nav.query = "";
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

  describe("an empty page past the first", () => {
    const previous = () => screen.getByRole("button", { name: /Previous/ });
    const pushedParams = () =>
      new URLSearchParams(String(nav.push.mock.calls.at(-1)?.[0]).split("?")[1] ?? "");

    it("keeps Previous and does not claim the library is empty (no search)", async () => {
      nav.query = "after=c2&stack=c1";
      api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

      await renderResults({ after: "c2" });

      expect(screen.getByText(en.files.noMoreFiles)).toBeInTheDocument();
      expect(screen.queryByText(en.files.emptyBody)).toBeNull();
      expect(screen.queryByText(en.files.noMatches)).toBeNull();
      expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
      expect(previous()).toBeEnabled();
      expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();

      fireEvent.click(previous());
      expect(pushedParams().get("after")).toBe("c1");
      expect(pushedParams().has("stack")).toBe(false);
    });

    it("keeps Previous with a search too, and the search rides along", async () => {
      nav.query = "q=beach&after=c1";
      api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

      await renderResults({ q: "beach", after: "c1" });

      expect(screen.getByText(en.files.noMoreFiles)).toBeInTheDocument();
      expect(screen.queryByText(en.files.noMatches)).toBeNull();
      fireEvent.click(previous());
      expect(pushedParams().get("q")).toBe("beach");
      expect(pushedParams().has("after")).toBe(false);
    });

    it("renders it in Arabic", async () => {
      nav.query = "after=c1";
      api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

      await renderResults({ t: ar, after: "c1" });

      expect(screen.getByText(ar.files.noMoreFiles)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: new RegExp(ar.files.previous) })).toBeEnabled();
    });

    it("deleting the only file on a later page leaves Previous, the dialogs and a truthful message", async () => {
      nav.query = "after=c1&stack=";
      actions.archiveFileAction.mockReset();
      api.fetchMediaFilesPage.mockResolvedValue(okPage([file("m-9", "Last.png")]));
      const withSearch = (element: Awaited<ReturnType<typeof resultsElement>>) => (
        <>
          <input id="files-search" aria-label="Search files" />
          {element}
        </>
      );
      const view = render(withSearch(await resultsElement({ after: "c1" })));
      actions.archiveFileAction.mockImplementation(async () => {
        api.fetchMediaFilesPage.mockResolvedValue(okPage([]));
        const next = await resultsElement({ after: "c1" });
        await act(async () => view.rerender(withSearch(next)));
        return { status: "success" };
      });
      fireEvent.click(screen.getByRole("button", { name: /^Last\.png/ }));
      const details = await within(document.body).findByRole("dialog", { name: "Last.png" });
      fireEvent.click(within(details).getByRole("button", { name: "Delete file" }));
      const confirm = await within(document.body).findByRole("dialog", { name: "Delete file?" });

      fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));

      await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull());
      expect(screen.getByText(en.files.noMoreFiles)).toBeInTheDocument();
      expect(screen.queryByText(en.files.emptyBody)).toBeNull();
      await waitFor(() => expect(previous()).toBeEnabled());
      expect(screen.getByRole("textbox", { name: "Search files" })).toHaveFocus();
    });
  });

  it("an empty first page without a search shows no pagination", async () => {
    api.fetchMediaFilesPage.mockResolvedValue(okPage([]));

    await renderResults();

    expect(screen.queryByRole("button", { name: /Previous/ })).toBeNull();
    expect(screen.queryByText(en.files.noMoreFiles)).toBeNull();
  });
});
