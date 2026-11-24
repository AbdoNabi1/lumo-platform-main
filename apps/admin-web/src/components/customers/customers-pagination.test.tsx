import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { CustomersPagination } = await import("./customers-pagination");

const pushedParams = () =>
  new URL(nav.push.mock.calls.at(-1)?.[0] as string, "http://x").searchParams;

beforeEach(() => {
  expect.hasAssertions();
  nav.push.mockReset();
  nav.search = "";
});

describe("CustomersPagination keeps the filters (Wave 1c: q and segment)", () => {
  it("Next keeps q and segment, stacks the current cursor and moves to the end cursor", () => {
    nav.search = "q=nour&segment=s-1&after=c-1";
    render(<CustomersPagination hasNextPage endCursor="c-2" t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.customersPage.next }));

    const params = pushedParams();
    expect(params.get("q")).toBe("nour");
    expect(params.get("segment")).toBe("s-1");
    expect(params.get("after")).toBe("c-2");
    expect(params.get("stack")).toBe("c-1");
  });

  it("Next from page 1 starts the stack with an empty entry (the first page has no cursor)", () => {
    nav.search = "segment=default%3Anot_purchased";
    render(<CustomersPagination hasNextPage endCursor="c-1" t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.customersPage.next }));

    const params = pushedParams();
    expect(params.get("segment")).toBe("default:not_purchased");
    expect(params.get("after")).toBe("c-1");
    expect(params.get("stack")).toBe("");
  });

  it("Previous pops the stack and keeps q and segment", () => {
    nav.search = "q=nour&segment=s-1&after=c-2&stack=c-0%2Cc-1";
    render(<CustomersPagination hasNextPage={false} endCursor={null} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.customersPage.previous }));

    const params = pushedParams();
    expect(params.get("after")).toBe("c-1");
    expect(params.get("stack")).toBe("c-0");
    expect(params.get("q")).toBe("nour");
    expect(params.get("segment")).toBe("s-1");
  });

  it("a deep link (after with no stack): Previous returns to page 1 and keeps the filters", () => {
    nav.search = "q=nour&segment=s-1&after=c-5";
    render(<CustomersPagination hasNextPage endCursor="c-6" t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.customersPage.previous }));

    const params = pushedParams();
    expect(params.has("after")).toBe(false);
    expect(params.has("stack")).toBe(false);
    expect(params.get("q")).toBe("nour");
    expect(params.get("segment")).toBe("s-1");
  });

  it("an empty later page (no next page) still offers an enabled Previous", () => {
    nav.search = "segment=s-1&after=c-9";
    render(<CustomersPagination hasNextPage={false} endCursor={null} t={en} />);

    expect(screen.getByRole("button", { name: en.customersPage.previous })).toBeEnabled();
    expect(screen.getByRole("button", { name: en.customersPage.next })).toBeDisabled();
  });

  it("renders nothing on a first page with no next page", () => {
    const { container } = render(
      <CustomersPagination hasNextPage={false} endCursor={null} t={en} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
