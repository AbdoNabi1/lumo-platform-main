import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MediaFileDto } from "@/lib/api/media";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({ fetchMediaFilesPage: vi.fn() }));
const actions = vi.hoisted(() => ({
  archiveFileAction: vi.fn(),
  uploadFileAction: vi.fn(),
  updateFileAltAction: vi.fn(),
  getFileDownloadUrlAction: vi.fn(),
}));
vi.mock("@/lib/api/media", () => api);
vi.mock("@/app/content/files/actions", () => actions);
vi.mock("@/lib/media/prepare-image", () => ({ prepareImage: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/content/files",
  useSearchParams: () => new URLSearchParams(),
}));

const { FilesResults } = await import("./files-results");
const { FilesToolbar } = await import("./files-toolbar");

const body = () => within(document.body);

const file = (name: string): MediaFileDto => ({
  id: `id-${name}`,
  name,
  status: "active",
  contentType: "image/png",
  byteSize: 2048,
  createdAt: "2026-11-24T10:00:00.000Z",
  image: { url: `https://cdn.test/${name}.webp`, alt: null, width: 1, height: 1 },
});

let library: MediaFileDto[] = [];
let view: "grid" | "list" = "grid";
let rendered: ReturnType<typeof render>;

async function page() {
  api.fetchMediaFilesPage.mockResolvedValue({
    outcome: "ok",
    data: { items: library, pageInfo: { hasNextPage: false, endCursor: null } },
  });
  return (
    <>
      <FilesToolbar q="" sort="newest" view={view} canEdit t={en} />
      {await FilesResults({
        q: "",
        sort: "newest",
        view,
        after: undefined,
        canEdit: true,
        t: en,
        locale: "en",
      })}
    </>
  );
}

/** What revalidating the page does: the same server component, re-read, without the deleted file. */
async function refresh(removed: string | null): Promise<void> {
  if (removed !== null) library = library.filter((f) => f.id !== removed);
  const next = await page();
  await act(async () => {
    rendered.rerender(next);
  });
}

async function mount(files: MediaFileDto[], mode: "grid" | "list" = "grid") {
  library = files;
  view = mode;
  const first = await page();
  rendered = render(first);
}

const tile = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

async function openDetails(name: string) {
  fireEvent.click(tile(name));
  return body().findByRole("dialog", { name });
}

async function openConfirm(details: HTMLElement) {
  fireEvent.click(within(details).getByRole("button", { name: "Delete file" }));
  return body().findByRole("dialog", { name: "Delete file?" });
}

/** Focus history: what took focus, and how many dialogs were still open at that moment. */
function recordFocus() {
  const history: { label: string; dialogs: number }[] = [];
  const onFocus = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    history.push({
      label: target.getAttribute("aria-label") ?? target.textContent?.trim() ?? target.tagName,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    });
  };
  document.addEventListener("focusin", onFocus);
  return { history, stop: () => document.removeEventListener("focusin", onFocus) };
}

const searchInput = () => screen.getByRole("searchbox", { name: "Search files" });
const escape = (el: HTMLElement) => fireEvent.keyDown(el, { key: "Escape" });

beforeEach(() => {
  expect.hasAssertions();
  actions.archiveFileAction.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleting a file whose tile the refresh removes", () => {
  it("grid: restores the Delete trigger, then closes details and focuses the next tile", async () => {
    await mount([file("A.png"), file("B.png"), file("C.png")]);
    actions.archiveFileAction.mockImplementation(async (id: string) => {
      await refresh(id);
      return { status: "success" };
    });
    const details = await openDetails("B.png");
    const confirm = await openConfirm(details);
    const focus = recordFocus();

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(tile("C.png")).toHaveFocus());
    focus.stop();
    expect(actions.archiveFileAction).toHaveBeenCalledWith("id-B.png");
    expect(screen.queryByRole("button", { name: /^B\.png/ })).toBeNull();
    // The Delete button inside the (still open) details dialog got focus first.
    const trigger = focus.history.find((entry) => entry.label === "Delete file");
    expect(trigger).toEqual({ label: "Delete file", dialogs: 1 });
    expect(focus.history.at(-1)?.label).toMatch(/^C\.png/);
    expect(document.body).not.toHaveFocus();
  });

  it("list: the last row falls back to the previous row", async () => {
    await mount([file("A.png"), file("B.png")], "list");
    actions.archiveFileAction.mockImplementation(async (id: string) => {
      await refresh(id);
      return { status: "success" };
    });
    const details = await openDetails("B.png");
    const confirm = await openConfirm(details);
    const focus = recordFocus();

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(tile("A.png")).toHaveFocus());
    focus.stop();
    expect(focus.history.find((entry) => entry.label === "Delete file")).toEqual({
      label: "Delete file",
      dialogs: 1,
    });
    expect(screen.getByRole("table", { name: "Files" })).toBeInTheDocument();
  });

  it("the only file: the grid turns into the empty library and focus lands on Search files", async () => {
    await mount([file("A.png")]);
    actions.archiveFileAction.mockImplementation(async (id: string) => {
      await refresh(id);
      return { status: "success" };
    });
    const details = await openDetails("A.png");
    const confirm = await openConfirm(details);
    const focus = recordFocus();

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(searchInput()).toHaveFocus());
    focus.stop();
    expect(screen.queryByRole("list", { name: "Files" })).toBeNull();
    expect(screen.getByText(en.files.emptyBody)).toBeInTheDocument();
    expect(focus.history.find((entry) => entry.label === "Delete file")?.dialogs).toBe(1);
    expect(document.body).not.toHaveFocus();
  });

  it("already archived: the refresh removes the file but the refusal stays visible in the open confirmation", async () => {
    await mount([file("A.png"), file("B.png"), file("C.png")]);
    actions.archiveFileAction.mockImplementation(async (id: string) => {
      await refresh(id);
      return { status: "error", message: en.files.delete.alreadyDeleted, fieldErrors: {} };
    });
    const details = await openDetails("B.png");
    const confirm = await openConfirm(details);

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));

    expect(await within(confirm).findByRole("alert")).toHaveTextContent(
      "This file was already deleted.",
    );
    expect(body().getByRole("dialog", { name: "Delete file?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^B\.png/, hidden: true })).toBeNull();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body().queryByRole("dialog", { name: "Delete file?" })).toBeNull());
    await waitFor(() =>
      expect(within(details).getByRole("button", { name: "Delete file" })).toHaveFocus(),
    );

    escape(details);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(tile("C.png")).toHaveFocus());
  });

  it("another failure keeps the confirmation open too", async () => {
    await mount([file("A.png")]);
    actions.archiveFileAction.mockRejectedValue(new Error("boom"));
    const details = await openDetails("A.png");
    const confirm = await openConfirm(details);

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));

    expect(await within(confirm).findByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
    expect(body().getByRole("dialog", { name: "Delete file?" })).toBeInTheDocument();
  });
});

describe("dismissing the confirmation while the delete is in flight", () => {
  function hold() {
    let settle!: (outcome: unknown) => void;
    actions.archiveFileAction.mockImplementation(
      () => new Promise((resolve) => (settle = resolve)),
    );
    return (outcome: unknown) => settle(outcome);
  }

  it("Escape closes it and returns focus; no second request; success then closes details and focuses the next tile", async () => {
    await mount([file("A.png"), file("B.png"), file("C.png")]);
    const settle = hold();
    const details = await openDetails("B.png");
    const confirm = await openConfirm(details);
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));
    expect(await within(confirm).findByRole("button", { name: "Deleting…" })).toBeDisabled();

    escape(confirm);

    await waitFor(() => expect(body().queryByRole("dialog", { name: "Delete file?" })).toBeNull());
    await waitFor(() =>
      expect(within(details).getByRole("button", { name: "Delete file" })).toHaveFocus(),
    );
    expect(body().getByRole("dialog", { name: "B.png" })).toBeInTheDocument();

    // Reopening shows the same request in flight; confirming again does not send another.
    const again = await openConfirm(details);
    const busy = within(again).getByRole("button", { name: "Deleting…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(actions.archiveFileAction).toHaveBeenCalledTimes(1);
    fireEvent.click(within(again).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body().queryByRole("dialog", { name: "Delete file?" })).toBeNull());

    await act(async () => {
      library = library.filter((f) => f.id !== "id-B.png");
      settle({ status: "success" });
    });
    await refresh(null);

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(tile("C.png")).toHaveFocus());
  });

  it("an error after dismissal does not reopen the confirmation; it shows in the details dialog", async () => {
    await mount([file("A.png"), file("B.png")]);
    const settle = hold();
    const details = await openDetails("B.png");
    const confirm = await openConfirm(details);
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));
    await within(confirm).findByRole("button", { name: "Deleting…" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body().queryByRole("dialog", { name: "Delete file?" })).toBeNull());

    await act(async () => {
      settle({ status: "error", message: "Couldn't delete it.", fieldErrors: {} });
    });

    expect(await within(details).findByRole("alert")).toHaveTextContent("Couldn't delete it.");
    expect(body().queryByRole("dialog", { name: "Delete file?" })).toBeNull();
    expect(body().getByRole("dialog", { name: "B.png" })).toBeInTheDocument();
  });

  it("completion does not close or steal focus from a different file's dialog", async () => {
    await mount([file("A.png"), file("B.png"), file("C.png")]);
    const settle = hold();
    const detailsB = await openDetails("B.png");
    const confirm = await openConfirm(detailsB);
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));
    await within(confirm).findByRole("button", { name: "Deleting…" });
    escape(confirm);
    await waitFor(() => expect(body().queryByRole("dialog", { name: "Delete file?" })).toBeNull());
    escape(detailsB);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(tile("B.png")).toHaveFocus());
    await openDetails("C.png");

    await act(async () => {
      library = library.filter((f) => f.id !== "id-B.png");
      settle({ status: "success" });
    });
    await refresh(null);

    expect(body().getByRole("dialog", { name: "C.png" })).toBeInTheDocument();
    expect(body().queryByRole("dialog", { name: "Delete file?" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^B\.png/, hidden: true })).toBeNull();
  });
});
