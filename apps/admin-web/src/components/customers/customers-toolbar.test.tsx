import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

/** A tiny router: `push` replaces the URL's query and re-renders, like a real navigation. */
const nav = vi.hoisted(() => ({
  search: "",
  pushed: [] as string[],
  rerender: () => {},
  /** Next hands out the same `ReadonlyURLSearchParams` until the URL changes; so does this. */
  memo: { key: null as string | null, value: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      nav.pushed.push(url);
      nav.search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
      nav.rerender();
    },
  }),
  usePathname: () => "/customers",
  useSearchParams: () => {
    if (nav.memo.key !== nav.search)
      nav.memo = { key: nav.search, value: new URLSearchParams(nav.search) };
    return nav.memo.value;
  },
}));

const { CustomersToolbar } = await import("./customers-toolbar");

const SEGMENTS = [
  { id: "default:not_purchased", label: "Haven't purchased" },
  { id: "s-1", label: "VIP" },
];

function Harness({
  t = en,
  segments = SEGMENTS,
}: {
  t?: Dictionary;
  segments?: typeof SEGMENTS | null;
}) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  nav.rerender = rerender;
  return <CustomersToolbar t={t} segments={segments} />;
}

const lastParams = () => new URLSearchParams(nav.pushed.at(-1)?.split("?")[1] ?? "");
const select = () => screen.getByRole("combobox", { name: en.customersPage.segmentLabel });
const searchBox = () => screen.getByRole("searchbox");

beforeEach(() => {
  expect.hasAssertions();
  vi.useFakeTimers();
  nav.search = "";
  nav.pushed = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CustomersToolbar segment select", () => {
  it("offers All customers, the default segments by label, then custom ones; selected from ?segment=", () => {
    nav.search = "segment=s-1";
    render(<Harness />);

    expect(
      Array.from((select() as HTMLSelectElement).options).map((o) => [o.value, o.textContent]),
    ).toEqual([
      ["", "All customers"],
      ["default:not_purchased", "Haven't purchased"],
      ["s-1", "VIP"],
    ]);
    expect(select()).toHaveValue("s-1");
  });

  it("choosing a segment writes ?segment=, keeps q, and clears after and stack", () => {
    nav.search = "q=nour&after=c-4&stack=c-1%2Cc-2";
    render(<Harness />);

    fireEvent.change(select(), { target: { value: "default:not_purchased" } });

    expect(nav.pushed).toHaveLength(1);
    const params = lastParams();
    expect(params.get("segment")).toBe("default:not_purchased");
    expect(params.get("q")).toBe("nour");
    expect(params.has("after")).toBe(false);
    expect(params.has("stack")).toBe(false);
  });

  it("choosing All customers removes segment (and goes to the bare path with nothing else set)", () => {
    nav.search = "segment=s-1&after=c-4";
    render(<Harness />);

    fireEvent.change(select(), { target: { value: "" } });

    expect(nav.pushed).toEqual(["/customers"]);
  });

  it("a search change keeps segment and clears after and stack", () => {
    nav.search = "segment=s-1&after=c-4&stack=c-1";
    render(<Harness />);

    fireEvent.change(searchBox(), { target: { value: " sam " } });
    act(() => void vi.advanceTimersByTime(350));

    expect(nav.pushed).toHaveLength(1);
    const params = lastParams();
    expect(params.get("q")).toBe("sam");
    expect(params.get("segment")).toBe("s-1");
    expect(params.has("after")).toBe(false);
    expect(params.has("stack")).toBe(false);
  });

  it("a pending search followed by a segment change ends with the new segment AND the typed search, and the timer never fires again", () => {
    render(<Harness />);

    fireEvent.change(searchBox(), { target: { value: "nour" } });
    act(() => void vi.advanceTimersByTime(100)); // still debouncing
    fireEvent.change(select(), { target: { value: "s-1" } });
    act(() => void vi.advanceTimersByTime(1000)); // the cancelled timer must not push a stale URL

    expect(nav.pushed).toHaveLength(1);
    const params = lastParams();
    expect(params.get("segment")).toBe("s-1");
    expect(params.get("q")).toBe("nour");
    expect(nav.search).toContain("segment=s-1");
  });

  it("a search typed after a segment change builds on the CURRENT URL (no stale closure)", () => {
    render(<Harness />);
    fireEvent.change(searchBox(), { target: { value: "a" } }); // timer made against the empty URL
    fireEvent.change(select(), { target: { value: "s-1" } });
    expect(nav.pushed).toHaveLength(1);

    fireEvent.change(searchBox(), { target: { value: "ab" } });
    act(() => void vi.advanceTimersByTime(350));

    expect(nav.pushed).toHaveLength(2);
    const params = lastParams();
    expect(params.get("segment")).toBe("s-1");
    expect(params.get("q")).toBe("ab");
  });

  it("a debounced search fired after the URL changed elsewhere uses the new URL", () => {
    render(<Harness />);
    fireEvent.change(searchBox(), { target: { value: "x" } });
    // Something else (a Previous/Next click) changes the URL while the timer is pending.
    act(() => {
      nav.search = "segment=s-1&after=c-9";
      nav.rerender();
    });
    act(() => void vi.advanceTimersByTime(350));

    const params = lastParams();
    expect(params.get("segment")).toBe("s-1");
    expect(params.get("q")).toBe("x");
    expect(params.has("after")).toBe(false);
  });

  it("an unknown or deleted segment in the URL stays visible as 'This segment no longer exists'", () => {
    nav.search = "segment=gone";
    render(<Harness />);

    expect(select()).toHaveValue("gone");
    expect(
      screen.getByRole("option", { name: en.customersPage.segmentMissing }),
    ).toBeInTheDocument();
  });

  it("without a segment list there is no select, and search still works", () => {
    render(<Harness segments={null} />);

    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.change(searchBox(), { target: { value: "nour" } });
    act(() => void vi.advanceTimersByTime(350));
    expect(lastParams().get("q")).toBe("nour");
  });

  it("renders in Arabic", () => {
    render(<Harness t={ar} />);

    expect(screen.getByRole("combobox", { name: ar.customersPage.segmentLabel })).toBeVisible();
    expect(screen.getByRole("option", { name: ar.customersPage.allCustomers })).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: ar.customersPage.searchPlaceholder }),
    ).toBeVisible();
  });

  it("a pending search is cancelled on unmount", () => {
    const { unmount } = render(<Harness />);
    fireEvent.change(searchBox(), { target: { value: "nour" } });

    unmount();
    act(() => void vi.advanceTimersByTime(1000));

    expect(nav.pushed).toHaveLength(0);
  });
});
