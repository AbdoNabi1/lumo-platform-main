import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({ searchLinkTargetsAction: vi.fn() }));
vi.mock("@/app/online-store/navigation/actions", () => actions);
const { LinkPicker } = await import("./link-picker");

const n = en.onlineStoreNavigation;

afterEach(() => {
  cleanup();
  actions.searchLinkTargetsAction.mockReset();
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
    fireEvent.click(await screen.findByRole("option", { name: /Sale/ }));
    expect(actions.searchLinkTargetsAction).toHaveBeenLastCalledWith("collection", "sa");
    expect(onChange).toHaveBeenLastCalledWith({ type: "collection", id: "c-1" });
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
    const option = await screen.findByRole("option", { name: /سياسة الاسترجاع/ });
    expect(option).not.toHaveTextContent("Refund policy");
    fireEvent.click(option);
    expect(onChange).toHaveBeenLastCalledWith({ type: "policy", policy: "refund" });
  });

  it("the latest answer wins when searches overlap", async () => {
    let answerFirst: (v: unknown) => void = () => undefined;
    actions.searchLinkTargetsAction
      .mockResolvedValueOnce([]) // on choosing the kind
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce([{ id: "p-2", title: "Sandals", subtitle: "/products/sandals" }]);
    render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "product" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "s" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sa" } });
    expect(await screen.findByRole("option", { name: /Sandals/ })).toBeInTheDocument();
    await act(async () => {
      answerFirst([{ id: "p-1", title: "Shirts", subtitle: "/products/shirts" }]);
      await Promise.resolve();
    });
    expect(screen.queryByRole("option", { name: /Shirts/ })).toBeNull();
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

  it("choosing a searchable kind clears the link until a result is picked", async () => {
    actions.searchLinkTargetsAction.mockResolvedValue([]);
    const onChange = vi.fn();
    render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "page" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(await screen.findByText(n.noResults)).toBeInTheDocument();
  });
});
