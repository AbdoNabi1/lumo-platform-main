import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { LeadsToolbar } from "./leads-toolbar";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  search: "",
}));
// like Next, the same object until the URL changes (a fresh one per render would reset the input)
const cache = vi.hoisted(() => ({ key: "", params: undefined as URLSearchParams | undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/leads",
  useSearchParams: () => {
    if (cache.params === undefined || cache.key !== navigation.search) {
      cache.key = navigation.search;
      cache.params = new URLSearchParams(navigation.search);
    }
    return cache.params;
  },
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

  it("selecting a status before the debounce fires pushes the typed search with it, once", () => {
    navigation.search = "";
    render(<LeadsToolbar t={en} />);
    const input = screen.getByLabelText(en.leadsPage.searchLabel);
    fireEvent.change(input, { target: { value: "Mona" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(screen.getByLabelText(en.leadsPage.statusFilterLabel), {
      target: { value: "qualified" },
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenLastCalledWith("/leads?q=Mona&status=qualified");
    expect(input).toHaveValue("Mona");
  });

  it("a search typed after a status change keeps that status even before the URL catches up", () => {
    navigation.search = "";
    render(<LeadsToolbar t={en} />);
    fireEvent.change(screen.getByLabelText(en.leadsPage.statusFilterLabel), {
      target: { value: "spam" },
    });
    fireEvent.change(screen.getByLabelText(en.leadsPage.searchLabel), { target: { value: "Ali" } });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(navigation.push).toHaveBeenLastCalledWith("/leads?q=Ali&status=spam");
  });

  it("caps the search at the API's 100 characters", () => {
    render(<LeadsToolbar t={en} />);
    expect(screen.getByLabelText(en.leadsPage.searchLabel)).toHaveAttribute("maxlength", "100");
  });
});
