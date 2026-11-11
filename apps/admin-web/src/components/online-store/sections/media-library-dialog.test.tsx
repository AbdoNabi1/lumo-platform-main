import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({ listLibraryImagesAction: vi.fn() }));
vi.mock("@/app/online-store/themes/actions", () => actions);
const { MediaLibraryDialog } = await import("./media-library-dialog");

const c = en.onlineStoreSections.image;
const item = (id: string, name: string, alt: string | null = null) => ({
  id,
  name,
  image: { id, url: `https://cdn.example/${id}.png`, alt, width: 40, height: 30 },
});
const page = (
  items: ReturnType<typeof item>[],
  hasNextPage = false,
  endCursor: string | null = null,
) => ({ status: "ok" as const, items, endCursor, hasNextPage });

const flush = () => act(async () => {});

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  cleanup();
  actions.listLibraryImagesAction.mockReset();
});

function open(onPick = vi.fn(), onOpenChange = vi.fn()) {
  const view = render(
    <MediaLibraryDialog t={en} open onOpenChange={onOpenChange} onPick={onPick} />,
  );
  return { ...view, onPick, onOpenChange };
}

describe("MediaLibraryDialog", () => {
  it("loads the first page when it opens and shows a button per image", async () => {
    actions.listLibraryImagesAction.mockResolvedValue(
      page([item("a", "Shoes"), item("b", "", "A cat")]),
    );
    open();
    await flush();
    expect(actions.listLibraryImagesAction).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: "Shoes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A cat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: c.loadMore })).toBeNull();
    expect(screen.queryByText(c.libraryEmpty)).toBeNull();
  });

  it("a thrown action shows the localised error and resets: Try again is enabled, not pending", async () => {
    actions.listLibraryImagesAction.mockRejectedValueOnce(new Error("offline"));
    open();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(c.libraryError);
    const retry = screen.getByRole("button", { name: c.retry });
    expect(retry).toBeEnabled();
    expect(retry).not.toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(c.libraryEmpty)).toBeNull();
    actions.listLibraryImagesAction.mockResolvedValueOnce(page([item("a", "Shoes")]));
    fireEvent.click(retry);
    await flush();
    expect(actions.listLibraryImagesAction).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "Shoes" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an error status from the action reads the same way", async () => {
    actions.listLibraryImagesAction.mockResolvedValue({ status: "error" });
    open();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(c.libraryError);
  });

  it("honours unstable_rethrow: a redirect propagates instead of becoming the error copy", async () => {
    class Boundary extends Component<{ children: ReactNode }, { caught: string | null }> {
      override state = { caught: null as string | null };
      static getDerivedStateFromError(error: unknown) {
        const digest = (error as { digest?: string }).digest ?? "";
        return { caught: digest };
      }
      override render() {
        return this.state.caught === null ? this.props.children : <p>caught {this.state.caught}</p>;
      }
    }
    actions.listLibraryImagesAction.mockImplementation(
      () =>
        new Promise((_, reject) => {
          try {
            redirect("/sign-in");
          } catch (error) {
            reject(error);
          }
        }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <Boundary>
        <MediaLibraryDialog t={en} open onOpenChange={vi.fn()} onPick={vi.fn()} />
      </Boundary>,
    );
    await flush();
    spy.mockRestore();
    expect(screen.getByText(/caught NEXT_REDIRECT/)).toBeInTheDocument();
    expect(screen.queryByText(c.libraryError)).toBeNull();
  });

  it("picking an image calls onPick with { id, url, alt, width, height } and closes", async () => {
    actions.listLibraryImagesAction.mockResolvedValue(page([item("a", "Shoes", "Red shoes")]));
    const { onPick, onOpenChange } = open();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Shoes" }));
    expect(onPick).toHaveBeenCalledWith({
      id: "a",
      url: "https://cdn.example/a.png",
      alt: "Red shoes",
      width: 40,
      height: 30,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Load more continues from the cursor and appends", async () => {
    actions.listLibraryImagesAction
      .mockResolvedValueOnce(page([item("a", "One")], true, "cur-1"))
      .mockResolvedValueOnce(page([item("b", "Two")], false, null));
    open();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: c.loadMore }));
    await flush();
    expect(actions.listLibraryImagesAction).toHaveBeenLastCalledWith("cur-1");
    expect(screen.getByRole("button", { name: "One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Two" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: c.loadMore })).toBeNull();
  });

  it("the empty state shows only when there is no next page (F17)", async () => {
    actions.listLibraryImagesAction.mockResolvedValueOnce(page([], true, "cur-1"));
    open();
    await flush();
    expect(screen.queryByText(c.libraryEmpty)).toBeNull();
    expect(screen.getByRole("button", { name: c.loadMore })).toBeInTheDocument();
    cleanup();
    actions.listLibraryImagesAction.mockResolvedValueOnce(page([], false));
    open();
    await flush();
    expect(screen.getByText(c.libraryEmpty)).toBeInTheDocument();
  });

  it("is portalled: the content is under document.body, not inside the caller's container", async () => {
    actions.listLibraryImagesAction.mockResolvedValue(page([item("a", "Shoes")]));
    const { container } = open();
    await flush();
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveAccessibleName(c.libraryTitle);
  });

  it("a closed dialog reads nothing", async () => {
    render(<MediaLibraryDialog t={en} open={false} onOpenChange={vi.fn()} onPick={vi.fn()} />);
    await flush();
    expect(actions.listLibraryImagesAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
