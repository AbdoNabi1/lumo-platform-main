/**
 * Home's "Set up your store" guide: which steps exist, where each one goes and whether it is done.
 * Import-free on purpose: the guide card is a client component, and anything it imports must not
 * pull `lib/api/*` (and with it `next/headers`) into the browser bundle.
 */

export type SetupStepId = "product" | "shipping" | "payments" | "theme" | "domain" | "order";

export interface SetupStep {
  readonly id: SetupStepId;
  /** `null` = not tracked (the theme step never shows a checkmark). */
  readonly done: boolean | null;
  readonly href: string;
}

/**
 * What the server learned about the shop. A fact is `null` when it could not be loaded: that step
 * then reads as not done, so a failed request neither hides the guide nor breaks Home.
 */
export interface SetupFacts {
  readonly productCount: number | null;
  readonly shippingZoneCount: number | null;
  readonly enabledPaymentMethods: number | null;
  readonly hasVerifiedCustomDomain: boolean | null;
  readonly orderCount: number | null;
}

function atLeastOne(count: number | null): boolean {
  return count !== null && count > 0;
}

/** The steps in Shopify's order. */
export function buildSetupSteps(facts: SetupFacts): SetupStep[] {
  return [
    { id: "product", done: atLeastOne(facts.productCount), href: "/products/new" },
    { id: "shipping", done: atLeastOne(facts.shippingZoneCount), href: "/settings/shipping" },
    { id: "payments", done: atLeastOne(facts.enabledPaymentMethods), href: "/settings/payments" },
    { id: "theme", done: null, href: "/theme" },
    { id: "domain", done: facts.hasVerifiedCustomDomain === true, href: "/settings/domains" },
    { id: "order", done: atLeastOne(facts.orderCount), href: "/orders" },
  ];
}

/** "N of M tasks complete": only the tracked steps count. */
export function setupProgress(steps: readonly SetupStep[]): { done: number; total: number } {
  const tracked = steps.filter((step) => step.done !== null);
  return { done: tracked.filter((step) => step.done === true).length, total: tracked.length };
}

/** False once the merchant dismissed the guide, or when every tracked step is done. */
export function setupGuideVisible(
  steps: readonly SetupStep[],
  dismissedAt: string | null | undefined,
): boolean {
  if (dismissedAt !== null && dismissedAt !== undefined && dismissedAt !== "") return false;
  const { done, total } = setupProgress(steps);
  return done < total;
}
