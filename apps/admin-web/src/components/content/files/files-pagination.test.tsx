import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const nav = vi.hoisted(() => ({ push: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/content/files",
  useSearchParams: () => new URLSearchParams(nav.query),
}));

const { FilesPagination } = await import("./files-pagination");

beforeEach(() => {
  expect.hasAssertions();
  nav.push.mockReset();
  nav.query = "";
});

const next = () => screen.getByRole("button", { name: /Next/ });
const previous = () => screen.getByRole("button", { name: /Previous/ });
const pushed = () => String(nav.push.mock.calls.at(-1)?.[0]);
const paramsOf = (url: string) => new URLSearchParams(url.split("?")[1] ?? "");

/** Renders one page and clicks; the URL it pushes becomes the next page's query. */
function click(
  query: string,
  hasNextPage: boolean,
  endCursor: string | null,
  button: "next" | "previous",
) {
  nav.query = query;
  nav.push.mockReset();
  const { unmount } = render(
    <FilesPagination hasNextPage={hasNextPage} endCursor={endCursor} t={en} />,
  );
  fireEvent.click(button === "next" ? next() : previous());
  unmount();
  return pushed();
}

describe("FilesPagination", () => {
  it("renders nothing on a single page", () => {
    const { container } = render(<FilesPagination hasNextPage={false} endCursor={null} t={en} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("walks three pages forward and back to page one with no after or stack", () => {
    const toPage2 = click("q=beach&sort=oldest&view=list", true, "c1", "next");
    expect(paramsOf(toPage2).get("after")).toBe("c1");
    expect(paramsOf(toPage2).get("stack")).toBe("");

    const toPage3 = click(toPage2.split("?")[1]!, true, "c2", "next");
    expect(paramsOf(toPage3).get("after")).toBe("c2");
    expect(paramsOf(toPage3).get("stack")).toBe("c1");

    const backToPage2 = click(toPage3.split("?")[1]!, false, null, "previous");
    expect(paramsOf(backToPage2).get("after")).toBe("c1");
    expect(paramsOf(backToPage2).has("stack")).toBe(false);

    const backToPage1 = click(backToPage2.split("?")[1]!, true, "c2", "previous");
    const finalParams = paramsOf(backToPage1);
    expect(finalParams.has("after")).toBe(false);
    expect(finalParams.has("stack")).toBe(false);
    expect(finalParams.get("q")).toBe("beach");
    expect(finalParams.get("sort")).toBe("oldest");
    expect(finalParams.get("view")).toBe("list");
  });

  it("a deep link with after and stack targets the right Previous page", () => {
    const url = click("after=c3&stack=c1,c2&sort=newest", true, "c4", "previous");
    const params = paramsOf(url);
    expect(params.get("after")).toBe("c2");
    expect(params.get("stack")).toBe("c1");
    expect(params.get("sort")).toBe("newest");
  });

  it("Next from a deep link pushes the current after onto the stack", () => {
    const url = click("after=c3&stack=c1,c2", true, "c4", "next");
    const params = paramsOf(url);
    expect(params.get("after")).toBe("c4");
    expect(params.get("stack")).toBe("c1,c2,c3");
  });

  it("disables Previous on page one and Next on the last page", () => {
    nav.query = "";
    const { unmount } = render(<FilesPagination hasNextPage endCursor="c1" t={en} />);
    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
    unmount();
    nav.query = "after=c1";
    render(<FilesPagination hasNextPage={false} endCursor={null} t={en} />);
    expect(previous()).toBeEnabled();
    expect(next()).toBeDisabled();
  });

  it("does not push when there is no cursor to go to", () => {
    nav.query = "";
    render(<FilesPagination hasNextPage endCursor={null} t={en} />);
    fireEvent.click(next());
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("mirrors the chevrons for right-to-left and speaks Arabic", () => {
    nav.query = "after=c1";
    const { container } = render(<FilesPagination hasNextPage endCursor="c2" t={ar} />);
    expect(screen.getByRole("button", { name: new RegExp(ar.files.previous) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(ar.files.next) })).toBeInTheDocument();
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon).toHaveClass("rtl:rotate-180");
  });
});
