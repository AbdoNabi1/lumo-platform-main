import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { OrdersToolbar } from "./orders-toolbar";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  search: "view=unpaid&after=cur-1&stack=a&exportError=too_many",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/orders",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/app/orders/annotation-actions", () => ({
  suggestOrderTagsAction: vi.fn().mockResolvedValue([]),
}));

describe("OrdersToolbar", () => {
  it("drops the cursor and a stale export error when the filter changes, keeping the tab", () => {
    render(<OrdersToolbar t={en} />);

    fireEvent.change(screen.getByLabelText(en.ordersPage.statusFilterLabel), {
      target: { value: "placed" },
    });

    expect(navigation.push).toHaveBeenCalledWith("/orders?view=unpaid&status=placed");
  });

  it("Tagged with adds a tag to the URL as one comma list, and removing it drops the param (Part 2)", () => {
    navigation.search = "view=unpaid&tag=vip";
    render(<OrdersToolbar t={en} />);
    const input = screen.getByLabelText("Tagged with");
    fireEvent.change(input, { target: { value: "urgent" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigation.push).toHaveBeenLastCalledWith("/orders?view=unpaid&tag=vip%2Curgent");
    fireEvent.click(screen.getByRole("button", { name: "Remove vip" }));
    expect(navigation.push).toHaveBeenLastCalledWith("/orders?view=unpaid");
  });
});
