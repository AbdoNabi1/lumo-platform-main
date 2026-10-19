import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderMoreActions, OrderRefundButton } from "./order-header-actions";

const actions = vi.hoisted(() => ({
  advanceOrderAction: vi.fn(),
  refundOrderAction: vi.fn(),
  archiveOrderAction: vi.fn(),
  unarchiveOrderAction: vi.fn(),
}));
vi.mock("@/app/orders/actions", () => actions);

beforeEach(() => {
  actions.advanceOrderAction.mockReset().mockResolvedValue({ status: "success" });
  actions.refundOrderAction.mockReset().mockResolvedValue({ status: "success" });
  actions.archiveOrderAction.mockReset().mockResolvedValue({ status: "success" });
  actions.unarchiveOrderAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrderMoreActions", () => {
  it("offers Cancel order and Print packing slip", () => {
    render(<OrderMoreActions orderId="order-1" canArchive canCancel archived={false} t={en} />);

    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Print packing slip" })).toBeInTheDocument();
    expect(screen.getByText("More actions")).toBeInTheDocument();
  });

  it("offers no Cancel order when the lifecycle does not allow cancelling", () => {
    render(
      <OrderMoreActions orderId="order-1" canArchive canCancel={false} archived={false} t={en} />,
    );

    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(screen.getByRole("link", { name: "Print packing slip" })).toBeInTheDocument();
  });

  it("asks before cancelling, and does nothing if the answer is no", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<OrderMoreActions orderId="order-1" canArchive canCancel archived={false} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    expect(confirm).toHaveBeenCalledWith(en.orderPage.confirmCancelOrder);
    expect(actions.advanceOrderAction).not.toHaveBeenCalled();
  });

  it("cancels through the existing advance action once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OrderMoreActions orderId="order-1" canArchive canCancel archived={false} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    await vi.waitFor(() => expect(actions.advanceOrderAction).toHaveBeenCalledTimes(1));
    const form = actions.advanceOrderAction.mock.calls[0]?.[1] as FormData;
    expect(form.get("orderId")).toBe("order-1");
    expect(form.get("toStatus")).toBe("cancelled");
  });

  it("links Print packing slip to the print page for this order, in a new tab", () => {
    render(<OrderMoreActions orderId="order-1" canArchive canCancel archived={false} t={en} />);
    const link = screen.getByRole("link", { name: "Print packing slip" });
    expect(link).toHaveAttribute("href", "/orders/packing-slips?ids=order-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("offers Archive for an order that is not archived, and Unarchive for one that is", async () => {
    const { rerender } = render(
      <OrderMoreActions orderId="order-1" canArchive canCancel={false} archived={false} t={en} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(actions.archiveOrderAction).toHaveBeenCalledTimes(1));
    rerender(<OrderMoreActions orderId="order-1" canArchive canCancel={false} archived t={en} />);
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("offers no Archive or Unarchive to a viewer, who keeps Print packing slip", () => {
    const { rerender } = render(
      <OrderMoreActions
        orderId="order-1"
        canArchive={false}
        canCancel={false}
        archived={false}
        t={en}
      />,
    );
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    rerender(
      <OrderMoreActions orderId="order-1" canArchive={false} canCancel={false} archived t={en} />,
    );
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
    expect(screen.getByRole("link", { name: "Print packing slip" })).toBeInTheDocument();
  });

  it("is available in Arabic", () => {
    render(<OrderMoreActions orderId="order-1" canArchive canCancel archived={false} t={ar} />);

    expect(screen.getByText(ar.orderPage.moreActions)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.orderPage.cancelOrder })).toBeInTheDocument();
  });
});

describe("OrderRefundButton", () => {
  it("is enabled when the order can be refunded, and asks before refunding", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <OrderRefundButton
        orderId="order-1"
        enabled
        confirmMessage="Refund $39.98 to the customer?"
        t={en}
      />,
    );
    const button = screen.getByRole("button", { name: "Refund" });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(confirm).toHaveBeenCalledWith("Refund $39.98 to the customer?");
    await vi.waitFor(() => expect(actions.refundOrderAction).toHaveBeenCalledTimes(1));
    expect((actions.refundOrderAction.mock.calls[0]?.[1] as FormData).get("orderId")).toBe(
      "order-1",
    );
  });

  it("is disabled, with the reason, when the order cannot be refunded", () => {
    render(<OrderRefundButton orderId="order-1" enabled={false} confirmMessage="unused" t={en} />);

    const button = screen.getByRole("button", { name: "Refund" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", en.orderPage.refundUnavailable);
  });
});
