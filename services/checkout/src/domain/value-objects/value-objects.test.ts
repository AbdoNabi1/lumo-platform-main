import { describe, expect, it } from "vitest";
import { CheckoutState } from "./checkout-state";

describe("CheckoutState", () => {
  it("exposes states and the started predicate", () => {
    expect(CheckoutState.started().isStarted).toBe(true);
    expect(CheckoutState.completed().value).toBe("completed");
    expect(CheckoutState.failed().value).toBe("failed");
    expect(CheckoutState.completed().isStarted).toBe(false);
  });
});
