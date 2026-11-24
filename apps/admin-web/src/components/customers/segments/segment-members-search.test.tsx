import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const nav = vi.hoisted(() => ({ push: vi.fn(), search: { value: "" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/customers/segments/s-1",
  useSearchParams: () => new URLSearchParams(nav.search.value),
}));

const { SegmentMembersSearch } = await import("./segment-members-search");

beforeEach(() => {
  expect.hasAssertions();
  vi.useFakeTimers();
  nav.push.mockReset();
  nav.search.value = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SegmentMembersSearch", () => {
  it("writes ?q= 350 ms after the last keystroke and clears after/stack", () => {
    nav.search.value = "after=c-5&stack=c-1";
    render(<SegmentMembersSearch t={en} />);
    const box = screen.getByRole("searchbox", { name: en.segments.members.searchPlaceholder });

    fireEvent.change(box, { target: { value: " nour " } });
    act(() => void vi.advanceTimersByTime(349));
    expect(nav.push).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/customers/segments/s-1?q=nour");
  });

  it("clearing the box removes q; the box starts from the URL", () => {
    nav.search.value = "q=sam";
    render(<SegmentMembersSearch t={en} />);
    const box = screen.getByRole("searchbox");
    expect(box).toHaveValue("sam");

    fireEvent.change(box, { target: { value: "" } });
    act(() => void vi.advanceTimersByTime(350));

    expect(nav.push).toHaveBeenCalledWith("/customers/segments/s-1");
  });
});
