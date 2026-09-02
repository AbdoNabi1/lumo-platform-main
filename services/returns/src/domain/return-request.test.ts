import { describe, expect, it } from "vitest";
import { BusinessRuleError, ProductRef, UniqueEntityId } from "@platform/domain";
import { ReturnItem } from "./value-objects/return-item";
import { ReturnRequest } from "./return-request";
import { ReturnDisposition } from "./value-objects/return-disposition";
import { ReturnReason } from "./value-objects/return-reason";
import { RefundDecision } from "./value-objects/refund-decision";

function productRef(value: string): ProductRef {
  const result = ProductRef.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function reason(): ReturnReason {
  const result = ReturnReason.create("defective");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function item(orderItemRef = "order-item-1"): ReturnItem {
  return ReturnItem.create(
    UniqueEntityId.from(orderItemRef),
    orderItemRef,
    productRef("product-1"),
    1,
    reason(),
  );
}

function returnRequest(): ReturnRequest {
  return ReturnRequest.create(UniqueEntityId.from("return-1"), "order-1", [item()]);
}

describe("ReturnRequest", () => {
  it("starts at requested and raises no events until the first transition", () => {
    const rr = returnRequest();
    expect(rr.status.value).toBe("requested");
    expect(rr.pullDomainEvents()).toHaveLength(0);

    rr.approve("evt-1", new Date(0));
    expect(rr.status.value).toBe("approved");
    const events = rr.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("return.transitioned");
  });

  it("runs the full Sprint 4.11 RMA walk to refund", () => {
    const rr = returnRequest();

    rr.approve("evt-1", new Date(0));
    rr.generateRma("RMA-1", "evt-2", new Date(0));
    expect(rr.status.value).toBe("rma_generated");
    expect(rr.rmaNumber).toBe("RMA-1");

    rr.receivePackage("evt-3", new Date(0));
    expect(rr.status.value).toBe("package_received");

    rr.inspectItem("order-item-1", true, new Date(0));
    rr.completeInspection("evt-4", new Date(0));
    expect(rr.status.value).toBe("inspection_completed");
    expect(rr.inspections).toHaveLength(1);

    const restock = ReturnDisposition.create("restock");
    if (!restock.ok) throw new Error("invalid fixture");
    rr.acceptItems(
      [{ orderItemRef: "order-item-1", disposition: restock.value }],
      "evt-5",
      new Date(0),
    );
    expect(rr.status.value).toBe("items_accepted");
    expect(rr.items[0]?.disposition?.value).toBe("restock");

    const decision = RefundDecision.create("refund", 1999, "USD");
    if (!decision.ok) throw new Error("invalid fixture");
    rr.decideResolution(decision.value, "evt-6", new Date(0));
    expect(rr.status.value).toBe("refund_requested");

    rr.close("evt-7", new Date(0));
    expect(rr.status.value).toBe("closed");
  });

  it("is idempotent by itemRef when inspecting the same item twice", () => {
    const rr = returnRequest();
    rr.inspectItem("order-item-1", true, new Date(0), "first");
    rr.inspectItem("order-item-1", false, new Date(0), "second");
    expect(rr.inspections).toHaveLength(1);
    expect(rr.inspections[0]?.note).toBe("first");
  });

  it("rejects an illegal transition (e.g. requested -> rma_generated directly, 409)", () => {
    const rr = returnRequest();
    expect(() => rr.transition("rma_generated", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects the return and closes it", () => {
    const rr = returnRequest();
    rr.reject("evt-1", new Date(0), "outside_window");
    expect(rr.status.value).toBe("rejected");
    expect(rr.approval?.approved).toBe(false);
    rr.close("evt-2", new Date(0));
    expect(rr.status.value).toBe("closed");
  });
});
