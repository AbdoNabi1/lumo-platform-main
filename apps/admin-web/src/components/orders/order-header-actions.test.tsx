import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderMoreActions, OrderRefundButton } from "./order-header-actions";

const actions = vi.hoisted(() => ({
  advanceOrderAction: vi.fn(),
  refundOrderAction: vi.fn(),
}));
vi.mock("@/app/orders/actions", () => actions);

beforeEach(() => {
  actions.advanceOrderAction.mockReset().mockResolvedValue({ status: "success" });
  actions.refundOrderAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrderMoreActions", () => {
  it("offers Cancel order and Print packing slip", () => {
    render(<OrderMoreActions orderId="order-1" canCancel t={en} />);

    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print packing slip" })).toBeInTheDocument();
    expect(screen.getByText("More actions")).toBeInTheDocument();
  });

  it("offers no Cancel order when the lifecycle does not allow cancelling", () => {
    render(<OrderMoreActions orderId="order-1" canCancel={false} t={en} />);

    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(screen.getByRole("button", { name: "Print packing slip" })).toBeInTheDocument();
  });

  it("asks before cancelling, and does nothing if the answer is no", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<OrderMoreActions orderId="order-1" canCancel t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    expect(confirm).toHaveBeenCalledWith(en.orderPage.confirmCancelOrder);
    expect(actions.advanceOrderAction).not.toHaveBeenCalled();
  });

  it("cancels through the existing advance action once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OrderMoreActions orderId="order-1" canCancel t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    await vi.waitFor(() => expect(actions.advanceOrderAction).toHaveBeenCalledTimes(1));
    const form = actions.advanceOrderAction.mock.calls[0]?.[1] as FormData;
    expect(form.get("orderId")).toBe("order-1");
    expect(form.get("toStatus")).toBe("cancelled");
  });

  it("prints the packing slip with the browser's print dialog", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<OrderMoreActions orderId="order-1" canCancel t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Print packing slip" }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it("is available in Arabic", () => {
    render(<OrderMoreActions orderId="order-1" canCancel t={ar} />);

    expect(screen.getByText(ar.orderPage.moreActions)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.orderPage.cancelOrder })).toBeInTheDocument();
  });
});

describe("OrderRefundButton", () => {
  it("is enabled when the order can be refunded, and asks before refunding", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OrderRefundButton orderId="order-1" enabled t={en} />);
    const button = screen.getByRole("button", { name: "Refund" });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(confirm).toHaveBeenCalledWith(en.orderLifecycle.confirmRefund);
    await vi.waitFor(() => expect(actions.refundOrderAction).toHaveBeenCalledTimes(1));
    expect((actions.refundOrderAction.mock.calls[0]?.[1] as FormData).get("orderId")).toBe(
      "order-1",
    );
  });

  it("is disabled, with the reason, when the order cannot be refunded", () => {
    render(<OrderRefundButton orderId="order-1" enabled={false} t={en} />);

    const button = screen.getByRole("button", { name: "Refund" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", en.orderPage.refundUnavailable);
  });
});
