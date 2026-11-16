import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { OrderSelectCheckbox, OrdersBulkBar, OrdersSelectionProvider } from "./orders-selection";

const actions = vi.hoisted(() => ({ bulkShipWithCarrierAction: vi.fn() }));
vi.mock("@/app/orders/carrier-actions", () => actions);

const carriers = [{ key: "bosta", displayName: "Bosta" }];

function ui(count: number, list = carriers) {
  return (
    <OrdersSelectionProvider>
      <OrdersBulkBar carriers={list} t={ar} />
      {Array.from({ length: count }, (_, i) => (
        <OrderSelectCheckbox
          key={i}
          orderId={String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(i) : "")}
          orderNumber={String(1000 + i)}
          t={ar}
        />
      ))}
    </OrdersSelectionProvider>
  );
}
const box = (n: number) => screen.getByRole("checkbox", { name: `حدّد الطلب #${n}` });

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
  vi.stubGlobal("open", vi.fn());
});

it("selecting rows shows the bar with the count", () => {
  render(ui(3));
  expect(screen.queryByText(/متحدد/)).toBeNull();
  fireEvent.click(box(1000));
  fireEvent.click(box(1001));
  expect(screen.getByText("2 متحدد")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: ar.carrierShipping.clearSelection }));
  expect(screen.queryByText(/متحدد/)).toBeNull();
});

it("the 51st selection is refused with the message", () => {
  render(ui(51));
  for (let n = 1000; n < 1050; n++) fireEvent.click(box(n));
  expect(screen.getByText("50 متحدد")).toBeInTheDocument();
  fireEvent.click(box(1050));
  expect(screen.getByText("50 متحدد")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(ar.carrierShipping.tooMany);
  expect(box(1050)).not.toBeChecked();
});

it("print opens the proxy URL with the selected ids", () => {
  render(ui(2));
  fireEvent.click(box(1000));
  fireEvent.click(box(1001));
  fireEvent.click(screen.getByRole("button", { name: ar.carrierShipping.printWaybills }));
  expect(window.open).toHaveBeenCalledWith(
    "/orders/awb?orderIds=a,b",
    "_blank",
    "noopener,noreferrer",
  );
});

it("hides ship when no carrier is enabled", () => {
  render(ui(1, []));
  fireEvent.click(box(1000));
  expect(screen.queryByRole("button", { name: "اشحن مع بوسطة" })).toBeNull();
  expect(
    screen.getByRole("button", { name: ar.carrierShipping.printWaybills }),
  ).toBeInTheDocument();
});

it("the bulk results dialog lists failures with reasons, then keeps focus on the bar", async () => {
  actions.bulkShipWithCarrierAction.mockResolvedValue({
    status: "success",
    shipped: 1,
    failed: [{ orderId: "b", orderNumber: "1001", message: "مش مدفوع" }],
  });
  render(ui(2));
  fireEvent.click(box(1000));
  fireEvent.click(box(1001));
  fireEvent.click(screen.getByRole("button", { name: "اشحن مع بوسطة" }));
  expect(await screen.findByText("#1001")).toBeInTheDocument();
  expect(screen.getByText("مش مدفوع")).toBeInTheDocument();
  expect(actions.bulkShipWithCarrierAction).toHaveBeenCalledWith(["a", "b"], "bosta");
  fireEvent.click(screen.getByRole("button", { name: ar.carrierShipping.close }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("1 متحدد")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "اشحن مع بوسطة" })).toHaveFocus());
});

it("a whole-run error is shown in the bar", async () => {
  actions.bulkShipWithCarrierAction.mockResolvedValue({ status: "error", message: "غلط" });
  render(ui(1));
  fireEvent.click(box(1000));
  fireEvent.click(screen.getByRole("button", { name: "اشحن مع بوسطة" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("غلط");
});
