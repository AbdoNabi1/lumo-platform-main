import { describe, expect, it } from "vitest";
import { buildSetupSteps, setupGuideVisible, setupProgress, type SetupFacts } from "./setup-guide";

const NOTHING: SetupFacts = {
  productCount: 0,
  shippingZoneCount: 0,
  enabledPaymentMethods: 0,
  hasVerifiedCustomDomain: false,
  orderCount: 0,
};

const EVERYTHING: SetupFacts = {
  productCount: 1,
  shippingZoneCount: 2,
  enabledPaymentMethods: 1,
  hasVerifiedCustomDomain: true,
  orderCount: 1,
};

const doneOf = (facts: SetupFacts) =>
  Object.fromEntries(buildSetupSteps(facts).map((step) => [step.id, step.done]));

describe("buildSetupSteps", () => {
  it("lists the steps in Shopify's order with their routes", () => {
    expect(buildSetupSteps(NOTHING).map((step) => [step.id, step.href])).toEqual([
      ["product", "/products/new"],
      ["shipping", "/settings/shipping"],
      ["payments", "/settings/payments"],
      ["theme", "/theme"],
      ["domain", "/settings/domains"],
      ["order", "/orders"],
    ]);
  });

  it("marks nothing done for a brand new store, and leaves the theme untracked", () => {
    expect(doneOf(NOTHING)).toEqual({
      product: false,
      shipping: false,
      payments: false,
      theme: null,
      domain: false,
      order: false,
    });
  });

  it("marks every tracked step done once the facts say so, and never the theme", () => {
    expect(doneOf(EVERYTHING)).toEqual({
      product: true,
      shipping: true,
      payments: true,
      theme: null,
      domain: true,
      order: true,
    });
  });

  it("treats a fact that could not be loaded as not done", () => {
    const unknown: SetupFacts = {
      productCount: null,
      shippingZoneCount: null,
      enabledPaymentMethods: null,
      hasVerifiedCustomDomain: null,
      orderCount: null,
    };
    expect(doneOf(unknown)).toEqual({
      product: false,
      shipping: false,
      payments: false,
      theme: null,
      domain: false,
      order: false,
    });
  });

  it("tracks each step independently", () => {
    expect(doneOf({ ...NOTHING, shippingZoneCount: 1, orderCount: 3 })).toMatchObject({
      product: false,
      shipping: true,
      order: true,
      domain: false,
    });
  });
});

describe("setupProgress", () => {
  it("counts only the tracked steps", () => {
    expect(setupProgress(buildSetupSteps(NOTHING))).toEqual({ done: 0, total: 5 });
    expect(setupProgress(buildSetupSteps({ ...NOTHING, productCount: 1, orderCount: 1 }))).toEqual({
      done: 2,
      total: 5,
    });
    expect(setupProgress(buildSetupSteps(EVERYTHING))).toEqual({ done: 5, total: 5 });
  });
});

describe("setupGuideVisible", () => {
  it("shows for a new store that has not dismissed it", () => {
    expect(setupGuideVisible(buildSetupSteps(NOTHING), null)).toBe(true);
    expect(setupGuideVisible(buildSetupSteps(NOTHING), undefined)).toBe(true);
  });

  it("stays visible while any tracked step is open", () => {
    expect(setupGuideVisible(buildSetupSteps({ ...EVERYTHING, orderCount: 0 }), null)).toBe(true);
  });

  it("hides once dismissed, even with steps open", () => {
    expect(setupGuideVisible(buildSetupSteps(NOTHING), "2026-10-17T10:00:00.000Z")).toBe(false);
  });

  it("hides when every tracked step is done", () => {
    expect(setupGuideVisible(buildSetupSteps(EVERYTHING), null)).toBe(false);
  });

  it("does not hide because facts failed to load", () => {
    const unknown = buildSetupSteps({
      productCount: null,
      shippingZoneCount: null,
      enabledPaymentMethods: null,
      hasVerifiedCustomDomain: null,
      orderCount: null,
    });
    expect(setupGuideVisible(unknown, null)).toBe(true);
  });
});
