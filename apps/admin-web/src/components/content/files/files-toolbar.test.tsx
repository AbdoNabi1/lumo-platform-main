import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const nav = vi.hoisted(() => ({ push: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/content/files",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/app/content/files/actions", () => ({ uploadFileAction: vi.fn() }));
vi.mock("@/lib/media/prepare-image", () => ({ prepareImage: vi.fn() }));

const { FilesToolbar } = await import("./files-toolbar");

beforeEach(() => {
  expect.hasAssertions();
  nav.push.mockReset();
  nav.query = "";
});

const lastParams = () =>
  new URLSearchParams(String(nav.push.mock.calls.at(-1)?.[0]).split("?")[1] ?? "");

function renderToolbar(
  props: Partial<{
    q: string;
    sort: "newest" | "oldest";
    view: "grid" | "list";
    canEdit: boolean;
  }> = {},
  t: Dictionary = en,
) {
  return render(
    <FilesToolbar
      q={props.q ?? ""}
      sort={props.sort ?? "newest"}
      view={props.view ?? "grid"}
      canEdit={props.canEdit ?? true}
      t={t}
    />,
  );
}

describe("FilesToolbar", () => {
  it("offers search, the two sorts, the view toggle and Upload files", () => {
    renderToolbar();

    expect(screen.getByRole("searchbox", { name: "Search files" })).toBeInTheDocument();
    const sort = screen.getByRole("combobox", { name: "Sort files" });
    expect(sort).toHaveValue("newest");
    expect([...(sort as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      "Date added (newest first)",
      "Date added (oldest first)",
    ]);
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Upload files" })).toBeInTheDocument();
  });

  it("hides Upload files from a viewer but keeps the browsing controls", () => {
    renderToolbar({ canEdit: false });

    expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search files" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort files" })).toBeInTheDocument();
  });

  it("submitting a search sets q and returns to page one, keeping sort and view", () => {
    nav.query = "sort=oldest&view=list&after=c3&stack=c1,c2";
    renderToolbar({ sort: "oldest", view: "list" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "  beach  " },
    });
    fireEvent.submit(screen.getByRole("search"));

    const params = lastParams();
    expect(params.get("q")).toBe("beach");
    expect(params.has("after")).toBe(false);
    expect(params.has("stack")).toBe(false);
    expect(params.get("sort")).toBe("oldest");
    expect(params.get("view")).toBe("list");
  });

  it("submitting an empty search clears q", () => {
    nav.query = "q=beach&after=c1";
    renderToolbar({ q: "beach" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: " " },
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(lastParams().has("q")).toBe(false);
    expect(lastParams().has("after")).toBe(false);
  });

  it("changing the sort resets to page one and keeps q and view", () => {
    nav.query = "q=beach&view=list&after=c3&stack=c1,c2";
    renderToolbar({ q: "beach", view: "list" });

    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "oldest" },
    });

    const params = lastParams();
    expect(params.get("sort")).toBe("oldest");
    expect(params.has("after")).toBe(false);
    expect(params.has("stack")).toBe(false);
    expect(params.get("q")).toBe("beach");
    expect(params.get("view")).toBe("list");
  });

  it("toggling the view keeps the page (after and stack) and q and sort", () => {
    nav.query = "q=beach&sort=oldest&after=c3&stack=c1,c2";
    renderToolbar({ q: "beach", sort: "oldest" });

    fireEvent.click(screen.getByRole("button", { name: "List view" }));

    const params = lastParams();
    expect(params.get("view")).toBe("list");
    expect(params.get("after")).toBe("c3");
    expect(params.get("stack")).toBe("c1,c2");
    expect(params.get("q")).toBe("beach");
    expect(params.get("sort")).toBe("oldest");
  });

  it("shows the current search in the box and renders in Arabic", () => {
    renderToolbar({ q: "شاطئ" }, ar);

    expect(screen.getByRole("searchbox", { name: ar.files.searchLabel })).toHaveValue("شاطئ");
    expect(screen.getByRole("button", { name: ar.files.upload })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: ar.files.sortLabel })).toBeInTheDocument();
    expect(screen.queryByText(en.files.upload)).toBeNull();
  });
});
