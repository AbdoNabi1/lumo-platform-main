import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { BulkShipResultsDialog } from "./bulk-ship-results-dialog";

beforeEach(() => {
  expect.hasAssertions();
});

it("lists failures with #orderNumber when present, else the order id, and the counts", () => {
  const onOpenChange = vi.fn();
  render(
    <BulkShipResultsDialog
      open
      onOpenChange={onOpenChange}
      shipped={2}
      failed={[
        { orderId: "o1", orderNumber: "1001", message: "مش مدفوع" },
        { orderId: "order-uuid-2", message: "بوسطة ماردّتش" },
      ]}
      t={ar}
    />,
  );
  expect(screen.getByText("اتشحن 2")).toBeInTheDocument();
  expect(screen.getByText("ماتشحنش 2")).toBeInTheDocument();
  expect(screen.getByText("#1001").tagName).toBe("BDI");
  expect(screen.getByText("order-uuid-2")).toBeInTheDocument();
  expect(screen.queryByText("#order-uuid-2")).toBeNull();
  expect(screen.getByText("مش مدفوع")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: ar.carrierShipping.close }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
