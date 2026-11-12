import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
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

describe("OrdersToolbar tag cap and repeated params", () => {
  it("reads every ?tag= param, and editing keeps all of them", () => {
    navigation.search = "tag=a&tag=b";
    render(<OrdersToolbar t={en} />);
    expect(screen.getByRole("button", { name: "Remove a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove b" })).toBeInTheDocument();
    const input = screen.getByLabelText("Tagged with");
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigation.push).toHaveBeenLastCalledWith("/orders?tag=a%2Cb%2Cc");
    fireEvent.click(screen.getByRole("button", { name: "Remove a" }));
    expect(navigation.push).toHaveBeenLastCalledWith("/orders?tag=b");
  });

  it("at 10 tags the input is read-only and says 'Up to 10 tags'", () => {
    navigation.search = `tag=${Array.from({ length: 10 }, (_, i) => `t${i}`).join(",")}`;
    render(<OrdersToolbar t={en} />);
    expect(screen.getByLabelText("Tagged with")).toHaveAttribute("readonly");
    expect(screen.getByText("Up to 10 tags")).toBeInTheDocument();
  });

  it("below the cap there is no hint and the input is editable", () => {
    navigation.search = "tag=a";
    render(<OrdersToolbar t={en} />);
    expect(screen.getByLabelText("Tagged with")).not.toHaveAttribute("readonly");
    expect(screen.queryByText("Up to 10 tags")).toBeNull();
  });

  it("says the cap in Arabic", () => {
    navigation.search = `tag=${Array.from({ length: 10 }, (_, i) => `t${i}`).join(",")}`;
    render(<OrdersToolbar t={ar} />);
    expect(screen.getByText("حتى ١٠ علامات")).toBeInTheDocument();
  });
});
