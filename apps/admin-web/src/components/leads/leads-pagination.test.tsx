import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { LeadsPagination } from "./leads-pagination";

const navigation = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => {
  expect.hasAssertions();
  navigation.push.mockClear();
  navigation.search = "";
});

describe("LeadsPagination", () => {
  it("renders nothing on a single page", () => {
    const { container } = render(<LeadsPagination hasNextPage={false} endCursor={null} t={en} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Next pushes after=<endCursor> and stacks the current cursor, keeping the filters", () => {
    navigation.search = "q=mona&status=new";
    render(<LeadsPagination hasNextPage endCursor="c2" t={en} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.leadsPage.next) }));
    expect(navigation.push).toHaveBeenCalledWith("/leads?q=mona&status=new&stack=&after=c2");
    expect(screen.getByRole("button", { name: new RegExp(en.leadsPage.previous) })).toBeDisabled();
  });

  it("Previous pops the stack", () => {
    navigation.search = "after=c2&stack=c1";
    render(<LeadsPagination hasNextPage endCursor="c3" t={en} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.leadsPage.previous) }));
    expect(navigation.push).toHaveBeenCalledWith("/leads?after=c1");
  });

  it("mirrors both chevrons in RTL", () => {
    navigation.search = "after=c2";
    const { container } = render(<LeadsPagination hasNextPage endCursor="c3" t={en} />);
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon).toHaveClass("rtl:-scale-x-100");
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});
