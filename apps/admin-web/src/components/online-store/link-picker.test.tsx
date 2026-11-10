import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({ searchLinkTargetsAction: vi.fn() }));
vi.mock("@/app/online-store/navigation/actions", () => actions);
const { LinkPicker, LINK_SEARCH_DEBOUNCE_MS } = await import("./link-picker");

const n = en.onlineStoreNavigation;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  actions.searchLinkTargetsAction.mockReset();
});

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("LinkPicker (spec 2.7)", () => {
  it("searches the chosen kind and picks a result", async () => {
    actions.searchLinkTargetsAction.mockResolvedValue([
      { id: "c-1", title: "Sale", subtitle: "/collections/sale" },
    ]);
    const onChange = vi.fn();
    render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "collection" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sa" } });
    await waitFor(() =>
      expect(actions.searchLinkTargetsAction).toHaveBeenLastCalledWith("collection", "sa"),
    );
    // Results are a plain list of buttons (review M-4): one tab stop each, no half-built listbox.
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Sale/ }));
    expect(actions.searchLinkTargetsAction).toHaveBeenLastCalledWith("collection", "sa");
    expect(onChange).toHaveBeenLastCalledWith({ type: "collection", id: "c-1" });
    expect(screen.getByRole("button", { name: /Sale/ })).toHaveAttribute("aria-pressed", "true");
    // The chosen target shows as a chip.
    expect(screen.getByTestId("link-chip")).toHaveTextContent("Sale");
  });

  it("policies show the shop's language titles", async () => {
    actions.searchLinkTargetsAction.mockResolvedValue([
      { id: "refund", title: "Refund policy", subtitle: "/policies/refund-policy" },
    ]);
    const onChange = vi.fn();
    render(<LinkPicker t={ar} locale="ar" value={{ type: "home" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(ar.onlineStoreNavigation.link), {
      target: { value: "policy" },
    });
    const option = await screen.findByRole("button", { name: /سياسة الاسترجاع/ });
    expect(option).not.toHaveTextContent("Refund policy");
    fireEvent.click(option);
    expect(onChange).toHaveBeenLastCalledWith({ type: "policy", policy: "refund" });
  });

  it("typing is debounced: one search for the last text", async () => {
    vi.useFakeTimers();
    actions.searchLinkTargetsAction.mockResolvedValue([]);
    render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "product" } });
    await tick(0);
    expect(actions.searchLinkTargetsAction).toHaveBeenCalledTimes(1); // choosing the kind
    for (const q of ["s", "su", "sum"]) {
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });
      await tick(LINK_SEARCH_DEBOUNCE_MS - 50);
    }
    expect(actions.searchLinkTargetsAction).toHaveBeenCalledTimes(1);
    await tick(50);
    expect(actions.searchLinkTargetsAction).toHaveBeenCalledTimes(2);
    expect(actions.searchLinkTargetsAction).toHaveBeenLastCalledWith("product", "sum");
  });

  it("the latest answer wins when searches overlap", async () => {
    vi.useFakeTimers();
    let answerFirst: (v: unknown) => void = () => undefined;
    actions.searchLinkTargetsAction
      .mockResolvedValueOnce([]) // on choosing the kind
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce([{ id: "p-2", title: "Sandals", subtitle: "/products/sandals" }]);
    render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "product" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "s" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sa" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: /Sandals/ })).toBeInTheDocument();
    await act(async () => {
      answerFirst([{ id: "p-1", title: "Shirts", subtitle: "/products/shirts" }]);
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: /Shirts/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Sandals/ })).toBeInTheDocument();
  });

  it("home, search and web address need no search", () => {
    const onChange = vi.fn();
    render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "search" } });
    expect(onChange).toHaveBeenLastCalledWith({ type: "search" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "url" } });
    expect(onChange).toHaveBeenLastCalledWith({ type: "url", url: "" });
    expect(actions.searchLinkTargetsAction).not.toHaveBeenCalled();
  });

  it("choosing a searchable kind clears the link; no results is announced outside the list", async () => {
    actions.searchLinkTargetsAction.mockResolvedValue([]);
    const onChange = vi.fn();
    render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "page" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    const status = await screen.findByText(n.noResults);
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(status.closest("ul")).toBeNull();
  });

  it("is described by the dialog's link error", () => {
    render(
      <>
        <LinkPicker
          t={en}
          locale="en"
          value={null}
          onChange={vi.fn()}
          invalid
          describedBy="link-error"
        />
        <p id="link-error">{n.invalidLink}</p>
      </>,
    );
    expect(screen.getByLabelText(n.link)).toHaveAccessibleDescription(n.invalidLink);
    expect(screen.getByLabelText(n.link)).toHaveAttribute("aria-invalid", "true");
  });
});
