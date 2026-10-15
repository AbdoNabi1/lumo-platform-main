import type { Promotion } from "./promotion";
import {
  canCombine,
  type CombinesWith,
  type DiscountClass,
} from "./value-objects/discount-settings";
import type { PromotionScope } from "./value-objects/promotion-rule";

/** Why a code gives nothing — the storefront turns each one into a sentence. */
export type DiscountRejection =
  | "not_found"
  | "expired"
  | "not_started"
  | "minimum_not_met"
  | "no_matching_items"
  | "not_eligible"
  | "usage_limit_reached"
  | "already_used"
  | "cannot_combine"
  | "too_many_codes";

/** At most this many codes per checkout (Shopify's limit for product/order codes). */
export const MAX_DISCOUNT_CODES = 5;

/** The form every code is compared in: trimmed, upper case — the same rule as `CouponCode`. */
export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface DiscountLine {
  readonly lineRef: string;
  readonly productRef: string;
  readonly categoryRefs: readonly string[];
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface DiscountShipping {
  readonly countryCode: string;
  readonly rateMinor: number;
}

export interface DiscountCustomer {
  readonly customerRef?: string;
  readonly email?: string;
}

/** What the calculator needs to know about a code — plain data, no Coupons import. */
export interface CouponState {
  readonly couponId: string;
  readonly code: string;
  readonly status: "active" | "disabled" | "expired" | "depleted";
  readonly usageLimit?: number;
  readonly usageCount: number;
  readonly oncePerCustomer: boolean;
  readonly assignedCustomerRef?: string;
  readonly expiresAt?: Date;
  readonly redemptions: readonly { readonly customerRef: string; readonly email?: string }[];
}

/** A discount that might apply: a promotion, with its coupon when it is reached by code. */
export interface DiscountCandidate {
  readonly promotion: Promotion;
  readonly coupon?: CouponState;
}

export interface CalculateDiscountsInput {
  readonly lines: readonly DiscountLine[];
  /** The destination and selected rate; `null` before a shipping method is chosen. */
  readonly shipping: DiscountShipping | null;
  readonly customer: DiscountCustomer;
  /** As the customer typed them; normalised and de-duplicated here. */
  readonly enteredCodes: readonly string[];
  /** The promotions behind the entered codes, plus the active automatic ones. */
  readonly candidates: readonly DiscountCandidate[];
  readonly now: Date;
}

export interface AppliedDiscount {
  readonly promotionId: string;
  readonly couponId?: string;
  readonly code?: string;
  readonly title: string;
  readonly discountClass: DiscountClass;
  readonly amountMinor: number;
}

export interface DiscountCodeStatus {
  readonly code: string;
  readonly applicable: boolean;
  readonly reason?: DiscountRejection;
}

export interface LineAllocation {
  readonly lineRef: string;
  readonly amountMinor: number;
}

export interface DiscountResult {
  readonly applied: readonly AppliedDiscount[];
  /** Product + order discounts. */
  readonly orderDiscountMinor: number;
  readonly shippingDiscountMinor: number;
  readonly codeStatuses: readonly DiscountCodeStatus[];
  /** How the product + order discounts split over the lines (for partial refunds). */
  readonly lineAllocations: readonly LineAllocation[];
}

interface Eligible {
  readonly candidate: DiscountCandidate;
  readonly promotionId: string;
  readonly code?: string;
  readonly discountClass: DiscountClass;
  readonly combinesWith: CombinesWith;
}

const CLASS_ORDER: Readonly<Record<DiscountClass, number>> = { product: 0, order: 1, shipping: 2 };

/** Above this many eligible discounts the best set is chosen greedily instead of exhaustively. */
const EXHAUSTIVE_LIMIT = 10;

function percentOf(amountMinor: number, percentage: number): number {
  return Math.floor((amountMinor * Math.round(percentage * 100)) / 10_000);
}

function lineTotal(line: DiscountLine): number {
  return line.unitPriceMinor * line.quantity;
}

function matchingLines(
  lines: readonly DiscountLine[],
  scope: PromotionScope,
  targetRefs: readonly string[],
): readonly DiscountLine[] {
  if (scope === "cart" || targetRefs.length === 0) return lines;
  if (scope === "product") return lines.filter((line) => targetRefs.includes(line.productRef));
  return lines.filter((line) => line.categoryRefs.some((ref) => targetRefs.includes(ref)));
}

function usedBy(coupon: CouponState, customer: DiscountCustomer): boolean {
  const email = customer.email?.toLowerCase();
  return coupon.redemptions.some(
    (r) =>
      (customer.customerRef !== undefined && r.customerRef === customer.customerRef) ||
      (email !== undefined && r.email !== undefined && r.email.toLowerCase() === email),
  );
}

/** What the cart must contain, and the minimum purchase — `null` when satisfied. */
function requirementRejection(
  promotion: Promotion,
  input: CalculateDiscountsInput,
): DiscountRejection | null {
  const { rule } = promotion;
  const { condition, reward } = rule;
  const matched = matchingLines(input.lines, condition.scope, condition.targetRefs);

  if (reward.type === "free_shipping" && input.shipping !== null) {
    if (reward.countries !== undefined && !reward.countries.includes(input.shipping.countryCode)) {
      return "not_eligible";
    }
    if (
      reward.maxShippingRateMinor !== undefined &&
      input.shipping.rateMinor > reward.maxShippingRateMinor
    ) {
      return "not_eligible";
    }
  }

  if (rule.type === "buy_x_get_y") {
    const { buys, gets } = reward;
    if (buys === undefined || gets === undefined) return "no_matching_items";
    if (
      matched.length === 0 ||
      matchingLines(input.lines, gets.scope, gets.targetRefs).length === 0
    ) {
      return "no_matching_items";
    }
    const bought =
      buys.kind === "quantity"
        ? matched.reduce((sum, line) => sum + line.quantity, 0)
        : matched.reduce((sum, line) => sum + lineTotal(line), 0);
    return bought < buys.value ? "minimum_not_met" : null;
  }

  if (promotion.discountClass === "product" && matched.length === 0) return "no_matching_items";
  const base = promotion.discountClass === "product" ? matched : input.lines;
  if (
    condition.minimumSubtotalAmountMinor !== undefined &&
    base.reduce((sum, line) => sum + lineTotal(line), 0) < condition.minimumSubtotalAmountMinor
  ) {
    return "minimum_not_met";
  }
  if (
    condition.minimumQuantity !== undefined &&
    base.reduce((sum, line) => sum + line.quantity, 0) < condition.minimumQuantity
  ) {
    return "minimum_not_met";
  }
  return null;
}

function rejectionFor(
  candidate: DiscountCandidate,
  input: CalculateDiscountsInput,
): DiscountRejection | null {
  const { promotion, coupon } = candidate;
  const now = input.now;

  if (coupon !== undefined) {
    if (coupon.status === "disabled") return "not_found";
    if (coupon.status === "expired") return "expired";
    if (coupon.status === "depleted") return "usage_limit_reached";
    if (coupon.expiresAt !== undefined && now.getTime() >= coupon.expiresAt.getTime()) {
      return "expired";
    }
  }

  switch (promotion.status.value) {
    case "draft":
    case "cancelled":
    case "archived":
      return "not_found";
    case "paused":
    case "expired":
      return "expired";
    case "depleted":
      return "usage_limit_reached";
    case "active":
    case "scheduled":
      break;
  }
  if (now.getTime() < promotion.schedule.startsAt.getTime()) return "not_started";
  if (promotion.schedule.isExpiredAt(now)) return "expired";

  const { customerRefs, segmentRefs } = promotion.eligibility;
  if (customerRefs !== undefined || segmentRefs !== undefined) {
    const ref = input.customer.customerRef;
    if (ref === undefined || customerRefs === undefined || !customerRefs.includes(ref)) {
      return "not_eligible";
    }
  }
  if (
    coupon?.assignedCustomerRef !== undefined &&
    coupon.assignedCustomerRef !== input.customer.customerRef
  ) {
    return "not_eligible";
  }

  if (promotion.usageLimit !== undefined && promotion.usageCount >= promotion.usageLimit) {
    return "usage_limit_reached";
  }
  if (coupon?.usageLimit !== undefined && coupon.usageCount >= coupon.usageLimit) {
    return "usage_limit_reached";
  }
  if (coupon?.oncePerCustomer === true && usedBy(coupon, input.customer)) return "already_used";

  return requirementRejection(promotion, input);
}

/** Splits `total` over the lines in proportion to their amounts; leftover units go to the largest remainders. */
function allocate(
  total: number,
  base: readonly { readonly ref: string; readonly amount: number }[],
): Map<string, number> {
  const result = new Map<string, number>();
  const sum = base.reduce((acc, b) => acc + b.amount, 0);
  if (total <= 0 || sum <= 0) {
    for (const b of base) result.set(b.ref, 0);
    return result;
  }
  const shares = base.map((b, index) => {
    const exact = (total * b.amount) / sum;
    return { ref: b.ref, index, value: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let left = total - shares.reduce((acc, s) => acc + s.value, 0);
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (left === 0) break;
    share.value += 1;
    left -= 1;
  }
  for (const share of shares) result.set(share.ref, share.value);
  return result;
}

function buyXGetYDiscounts(
  promotion: Promotion,
  lines: readonly DiscountLine[],
  remaining: ReadonlyMap<string, number>,
): Map<string, number> {
  const { rule } = promotion;
  const { buys, gets, maxUsesPerOrder } = rule.reward;
  const result = new Map<string, number>();
  if (buys === undefined || gets === undefined) return result;

  const buysRefs = new Set(
    matchingLines(lines, rule.condition.scope, rule.condition.targetRefs).map((l) => l.lineRef),
  );
  const getsRefs = new Set(matchingLines(lines, gets.scope, gets.targetRefs).map((l) => l.lineRef));
  // One entry per unit, priced at what is left of its line after earlier discounts.
  const units = lines.flatMap((line) => {
    const unitPrice = Math.floor((remaining.get(line.lineRef) ?? 0) / line.quantity);
    return Array.from({ length: line.quantity }, () => ({ ref: line.lineRef, price: unitPrice }));
  });
  const indexes = units.map((_, index) => index);
  const getsOrder = indexes
    .filter((i) => getsRefs.has(units[i]!.ref))
    .sort((a, b) => units[a]!.price - units[b]!.price || a - b);
  const buysOrder = indexes
    .filter((i) => buysRefs.has(units[i]!.ref))
    .sort((a, b) => units[b]!.price - units[a]!.price || a - b);

  const used = new Set<number>();
  const got: number[] = [];
  const maxUses = maxUsesPerOrder ?? Number.POSITIVE_INFINITY;
  let uses = 0;

  if (buys.kind === "amount") {
    // The free units are picked first (the cheapest qualifying ones); the amount must then be met
    // by the remaining buying units alone, so a free unit never counts towards its own threshold.
    const free = getsOrder.slice(0, gets.quantity);
    const freeAmountFromBuys = free
      .filter((i) => buysRefs.has(units[i]!.ref))
      .reduce((sum, i) => sum + units[i]!.price, 0);
    const bought =
      lines
        .filter((line) => buysRefs.has(line.lineRef))
        .reduce((sum, line) => sum + (remaining.get(line.lineRef) ?? 0), 0) - freeAmountFromBuys;
    if (bought >= buys.value && maxUses >= 1 && free.length === gets.quantity) got.push(...free);
  } else {
    while (uses < maxUses) {
      const bought = buysOrder.filter((i) => !used.has(i)).slice(0, buys.value);
      if (bought.length < buys.value) break;
      for (const i of bought) used.add(i);
      const free = getsOrder.filter((i) => !used.has(i)).slice(0, gets.quantity);
      if (free.length < gets.quantity) break;
      for (const i of free) {
        used.add(i);
        got.push(i);
      }
      uses += 1;
    }
  }

  for (const i of got) {
    const unit = units[i]!;
    const off = gets.effect.kind === "free" ? unit.price : percentOf(unit.price, gets.effect.value);
    result.set(unit.ref, (result.get(unit.ref) ?? 0) + off);
  }
  for (const [ref, amount] of result) result.set(ref, Math.min(amount, remaining.get(ref) ?? 0));
  return result;
}

/** What one product/order discount takes off each line, given what is left of each line. */
function lineDiscounts(
  promotion: Promotion,
  lines: readonly DiscountLine[],
  remaining: ReadonlyMap<string, number>,
): Map<string, number> {
  const { rule } = promotion;
  if (rule.type === "buy_x_get_y") return buyXGetYDiscounts(promotion, lines, remaining);

  const isProduct = promotion.discountClass === "product";
  const targets = isProduct
    ? matchingLines(lines, rule.condition.scope, rule.condition.targetRefs)
    : lines;
  const base = targets.map((line) => ({
    ref: line.lineRef,
    amount: remaining.get(line.lineRef) ?? 0,
    quantity: line.quantity,
  }));
  const total = base.reduce((sum, b) => sum + b.amount, 0);
  const value = rule.reward.value ?? 0;

  if (rule.reward.type === "percentage") {
    if (isProduct) return new Map(base.map((b) => [b.ref, percentOf(b.amount, value)]));
    return allocate(percentOf(total, value), base);
  }
  // fixed_amount
  if (isProduct && rule.reward.appliesOncePerOrder !== true) {
    return new Map(base.map((b) => [b.ref, Math.min(b.amount, value * b.quantity)]));
  }
  return allocate(Math.min(value, total), base);
}

interface Application {
  readonly applied: readonly AppliedDiscount[];
  readonly allocations: ReadonlyMap<string, number>;
  readonly total: number;
}

/** Applies a compatible set in Shopify's order: product, then order, then shipping. */
function applySet(set: readonly Eligible[], input: CalculateDiscountsInput): Application {
  const remaining = new Map(input.lines.map((line) => [line.lineRef, lineTotal(line)]));
  const allocations = new Map<string, number>();
  let shippingLeft = input.shipping?.rateMinor ?? 0;
  const ordered = [...set].sort(
    (a, b) =>
      CLASS_ORDER[a.discountClass] - CLASS_ORDER[b.discountClass] ||
      a.promotionId.localeCompare(b.promotionId),
  );

  const applied: AppliedDiscount[] = [];
  for (const entry of ordered) {
    let amount = 0;
    if (entry.discountClass === "shipping") {
      amount = shippingLeft;
      shippingLeft = 0;
    } else {
      for (const [ref, off] of lineDiscounts(entry.candidate.promotion, input.lines, remaining)) {
        if (off <= 0) continue;
        remaining.set(ref, (remaining.get(ref) ?? 0) - off);
        allocations.set(ref, (allocations.get(ref) ?? 0) + off);
        amount += off;
      }
    }
    applied.push({
      promotionId: entry.promotionId,
      ...(entry.candidate.coupon === undefined
        ? {}
        : { couponId: entry.candidate.coupon.couponId }),
      ...(entry.code === undefined ? {} : { code: entry.code }),
      title: entry.candidate.promotion.name,
      discountClass: entry.discountClass,
      amountMinor: amount,
    });
  }
  return { applied, allocations, total: applied.reduce((sum, a) => sum + a.amountMinor, 0) };
}

function isCompatible(set: readonly Eligible[]): boolean {
  for (let i = 0; i < set.length; i += 1) {
    for (let j = i + 1; j < set.length; j += 1) {
      if (!canCombine(set[i]!, set[j]!)) return false;
    }
  }
  return true;
}

/** Larger saving wins; then more entered codes; then the earlier-created discounts. */
function isBetter(
  a: Application & { set: readonly Eligible[] },
  b: Application & { set: readonly Eligible[] },
): boolean {
  if (a.total !== b.total) return a.total > b.total;
  const codesA = a.set.filter((e) => e.code !== undefined).length;
  const codesB = b.set.filter((e) => e.code !== undefined).length;
  if (codesA !== codesB) return codesA > codesB;
  const key = (s: readonly Eligible[]) =>
    s
      .map((e) => e.promotionId)
      .sort()
      .join("|");
  return key(a.set) < key(b.set);
}

function bestSet(
  eligible: readonly Eligible[],
  input: CalculateDiscountsInput,
): Application & { set: readonly Eligible[] } {
  let best: Application & { set: readonly Eligible[] } = { ...applySet([], input), set: [] };
  if (eligible.length <= EXHAUSTIVE_LIMIT) {
    for (let mask = 1; mask < 1 << eligible.length; mask += 1) {
      const set = eligible.filter((_, i) => (mask & (1 << i)) !== 0);
      if (!isCompatible(set)) continue;
      const candidate = { ...applySet(set, input), set };
      if (isBetter(candidate, best)) best = candidate;
    }
    return best;
  }
  const bySaving = [...eligible].sort(
    (a, b) => applySet([b], input).total - applySet([a], input).total,
  );
  const set: Eligible[] = [];
  for (const entry of bySaving) {
    if (isCompatible([...set, entry])) set.push(entry);
  }
  return { ...applySet(set, input), set };
}

/**
 * Decides which discounts a cart gets and how much each one takes off — pure, no I/O. Codes are
 * matched to their coupons; automatic promotions apply on their own; a promotion reached only by
 * code never applies without it. Among the eligible discounts, the compatible set that saves the
 * most wins (spec "The calculation").
 */
export function calculateDiscounts(input: CalculateDiscountsInput): DiscountResult {
  const codes = [...new Set(input.enteredCodes.map(normalizeDiscountCode))].filter((c) => c !== "");
  const activeCodes = codes.slice(0, MAX_DISCOUNT_CODES);

  const rejections = new Map<string, DiscountRejection>();
  const eligible: Eligible[] = [];
  for (const candidate of input.candidates) {
    const code =
      candidate.coupon === undefined ? undefined : normalizeDiscountCode(candidate.coupon.code);
    if (code !== undefined && !activeCodes.includes(code)) continue;
    if (code === undefined && candidate.promotion.method !== "automatic") continue;
    const reason = rejectionFor(candidate, input);
    if (reason !== null) {
      if (code !== undefined) rejections.set(code, reason);
      continue;
    }
    eligible.push({
      candidate,
      promotionId: candidate.promotion.id.toString(),
      ...(code === undefined ? {} : { code }),
      discountClass: candidate.promotion.discountClass,
      combinesWith: candidate.promotion.combinesWith,
    });
  }

  const best = bestSet(eligible, input);
  // A product or order code the winning set gives nothing for is not applicable, even though the
  // set includes it. A shipping code stays applicable at 0 until a rate is chosen.
  const emptyCodes = new Set<string>();
  for (const a of best.applied) {
    if (a.code !== undefined && a.amountMinor === 0 && a.discountClass !== "shipping") {
      emptyCodes.add(a.code);
    }
  }
  const chosenCodes = new Set(
    best.set.map((e) => e.code).filter((c): c is string => c !== undefined && !emptyCodes.has(c)),
  );
  const applied = best.applied.filter((a) =>
    a.code === undefined ? a.amountMinor > 0 : !emptyCodes.has(a.code),
  );

  const codeStatuses: DiscountCodeStatus[] = codes.map((code, index) => {
    if (index >= MAX_DISCOUNT_CODES) return { code, applicable: false, reason: "too_many_codes" };
    if (emptyCodes.has(code)) return { code, applicable: false, reason: "no_matching_items" };
    if (chosenCodes.has(code)) return { code, applicable: true };
    const rejection = rejections.get(code);
    if (rejection !== undefined) return { code, applicable: false, reason: rejection };
    const known = eligible.some((e) => e.code === code);
    return { code, applicable: false, reason: known ? "cannot_combine" : "not_found" };
  });

  return {
    applied,
    orderDiscountMinor: applied
      .filter((a) => a.discountClass !== "shipping")
      .reduce((sum, a) => sum + a.amountMinor, 0),
    shippingDiscountMinor: applied
      .filter((a) => a.discountClass === "shipping")
      .reduce((sum, a) => sum + a.amountMinor, 0),
    codeStatuses,
    lineAllocations: input.lines
      .map((line) => ({
        lineRef: line.lineRef,
        amountMinor: best.allocations.get(line.lineRef) ?? 0,
      }))
      .filter((allocation) => allocation.amountMinor > 0),
  };
}
