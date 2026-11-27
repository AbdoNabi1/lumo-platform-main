import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { CancelShipmentButton, ShipAgainButton, ShipButton } from "./carrier-shipment-actions";

const actions = vi.hoisted(() => ({
  shipWithCarrierAction: vi.fn(),
  retryCarrierShipmentAction: vi.fn(),
  cancelCarrierShipmentAction: vi.fn(),
}));
vi.mock("@/app/orders/carrier-actions", () => actions);

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
});

it("ship calls the action and shows the localised error", async () => {
  actions.shipWithCarrierAction.mockResolvedValue({ status: "error", message: "مش مدفوع" });
  render(<ShipButton orderId="o1" carrierKey="bosta" carrierName="بوسطة" t={ar} />);
  fireEvent.click(screen.getByRole("button", { name: "اشحن مع بوسطة" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("مش مدفوع");
  expect(actions.shipWithCarrierAction).toHaveBeenCalledWith("o1", "bosta");
});

it("ship again calls retry then ship through the retry action", async () => {
  actions.retryCarrierShipmentAction.mockResolvedValue({ status: "success", trackingNumber: "T" });
  render(<ShipAgainButton orderId="o1" shipmentId="s1" carrierKey="bosta" t={ar} />);
  fireEvent.click(screen.getByRole("button", { name: ar.carrierShipping.shipAgain }));
  await waitFor(() =>
    expect(actions.retryCarrierShipmentAction).toHaveBeenCalledWith("o1", "s1", "bosta"),
  );
});

it("cancel asks first, focuses the dismiss button, and escape cancels nothing", async () => {
  render(<CancelShipmentButton orderId="o1" shipmentId="s1" t={ar} />);
  const trigger = screen.getByRole("button", { name: ar.carrierShipping.cancelShipment });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(ar.carrierShipping.confirmCancel);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: ar.carrierSettings.cancel })).toHaveFocus(),
  );
  fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(actions.cancelCarrierShipmentAction).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("confirming cancels the shipment and surfaces an error", async () => {
  actions.cancelCarrierShipmentAction.mockResolvedValue({
    status: "error",
    message: "بوسطة استلمت",
    fieldErrors: {},
  });
  render(<CancelShipmentButton orderId="o1" shipmentId="s1" t={ar} />);
  fireEvent.click(screen.getByRole("button", { name: ar.carrierShipping.cancelShipment }));
  await screen.findByRole("dialog");
  const buttons = screen.getAllByRole("button", { name: ar.carrierShipping.cancelShipment });
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(actions.cancelCarrierShipmentAction).toHaveBeenCalledWith("o1", "s1"));
  expect(await screen.findByRole("alert")).toHaveTextContent("بوسطة استلمت");
});
