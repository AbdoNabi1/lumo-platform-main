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

describe("OrdersToolbar", () => {
  it("drops the cursor and a stale export error when the filter changes, keeping the tab", () => {
    render(<OrdersToolbar t={en} />);

    fireEvent.change(screen.getByLabelText(en.ordersPage.statusFilterLabel), {
      target: { value: "placed" },
    });

    expect(navigation.push).toHaveBeenCalledWith("/orders?view=unpaid&status=placed");
  });
});
