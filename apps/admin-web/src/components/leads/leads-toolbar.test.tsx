import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { LeadsToolbar } from "./leads-toolbar";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => {
  expect.hasAssertions();
  navigation.push.mockClear();
  navigation.search = "after=cur-1&stack=a&exportError=failed";
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LeadsToolbar", () => {
  it("offers All first, then the six statuses", () => {
    render(<LeadsToolbar t={en} />);
    const select = screen.getByLabelText(en.leadsPage.statusFilterLabel);
    const options = [...select.querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual([
      en.leadsPage.allStatuses,
      en.leadStatus.new,
      en.leadStatus.contacted,
      en.leadStatus.qualified,
      en.leadStatus.converted,
      en.leadStatus.rejected,
      en.leadStatus.spam,
    ]);
    expect(options.map((o) => o.value)).toEqual([
      "",
      "new",
      "contacted",
      "qualified",
      "converted",
      "rejected",
      "spam",
    ]);
    expect(select).toHaveValue("");
  });

  it("sends status=<value> and drops the cursor and a stale export error", () => {
    render(<LeadsToolbar t={en} />);
    fireEvent.change(screen.getByLabelText(en.leadsPage.statusFilterLabel), {
      target: { value: "qualified" },
    });
    expect(navigation.push).toHaveBeenCalledWith("/leads?status=qualified");
  });

  it("choosing All sends no status", () => {
    navigation.search = "status=spam&q=mona";
    render(<LeadsToolbar t={en} />);
    fireEvent.change(screen.getByLabelText(en.leadsPage.statusFilterLabel), {
      target: { value: "" },
    });
    expect(navigation.push).toHaveBeenCalledWith("/leads?q=mona");
  });

  it("debounces the search by 350 ms and trims it", () => {
    render(<LeadsToolbar t={en} />);
    const input = screen.getByLabelText(en.leadsPage.searchLabel);

    fireEvent.change(input, { target: { value: " mo" } });
    fireEvent.change(input, { target: { value: " mona " } });
    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(navigation.push).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith("/leads?q=mona");
  });

  it("clearing the search removes q", () => {
    navigation.search = "q=mona&status=new";
    render(<LeadsToolbar t={en} />);
    fireEvent.change(screen.getByLabelText(en.leadsPage.searchLabel), { target: { value: "" } });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(navigation.push).toHaveBeenCalledWith("/leads?status=new");
  });

  it("caps the search at the API's 100 characters", () => {
    render(<LeadsToolbar t={en} />);
    expect(screen.getByLabelText(en.leadsPage.searchLabel)).toHaveAttribute("maxlength", "100");
  });
});
