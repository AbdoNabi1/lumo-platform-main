/**
 * Merchant billing: the shapes `GET /store/billing[/plans]` answer, and the pure helpers a screen
 * needs. Import-free on purpose — client components may import this module, whereas `lib/api/*`
 * pulls `next/headers` into the browser bundle.
 */

/** Mirrors the runtime's `MerchantPlanView`. */
export interface MerchantPlanDto {
  readonly key: string;
  readonly name: string;
  /** The published version's id — what a subscription pins. */
  readonly planVersionRef: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly billingCycle: "monthly" | "annual";
  readonly trialDays: number;
}

/** Mirrors the runtime's `MerchantInvoiceView`. */
export interface MerchantInvoiceDto {
  readonly id: string;
  readonly status: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly createdAt: string;
}

/** Mirrors the runtime's `MerchantBillingView`. */
export interface MerchantBillingDto {
  /** `null` means no subscription yet. */
  readonly plan: MerchantPlanDto | null;
  /** The subscription status; `null` means no subscription yet. */
  readonly status: string | null;
  readonly nextChargeAt: string | null;
  /** The end of the free trial; `null` means not in a trial. */
  readonly trialEndsAt: string | null;
  readonly cardOnFile: boolean;
  readonly invoices: readonly MerchantInvoiceDto[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isMerchantPlanDto(value: unknown): value is MerchantPlanDto {
  if (!isRecord(value)) return false;
  return (
    typeof value["key"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["planVersionRef"] === "string" &&
    typeof value["priceMinor"] === "number" &&
    typeof value["currency"] === "string" &&
    (value["billingCycle"] === "monthly" || value["billingCycle"] === "annual") &&
    typeof value["trialDays"] === "number"
  );
}

export function isMerchantInvoiceDto(value: unknown): value is MerchantInvoiceDto {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["status"] === "string" &&
    typeof value["totalMinor"] === "number" &&
    typeof value["currency"] === "string" &&
    typeof value["createdAt"] === "string"
  );
}

export function isMerchantBillingDto(value: unknown): value is MerchantBillingDto {
  if (!isRecord(value)) return false;
  return (
    (value["plan"] === null || isMerchantPlanDto(value["plan"])) &&
    isStringOrNull(value["status"]) &&
    isStringOrNull(value["nextChargeAt"]) &&
    isStringOrNull(value["trialEndsAt"]) &&
    typeof value["cardOnFile"] === "boolean" &&
    Array.isArray(value["invoices"]) &&
    value["invoices"].every(isMerchantInvoiceDto)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days left in the trial, rounded up (a partial day still counts); 0 once it has ended;
 * `null` when there is no trial (or the date cannot be read).
 */
export function trialDaysLeft(trialEndsAt: string | null, now: Date): number | null {
  if (trialEndsAt === null) return null;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

/** Subscription states in which the merchant's payment has failed or lapsed. */
const PAST_DUE_STATUSES: readonly string[] = ["grace", "suspended", "expired"];

/**
 * The notice Home / Settings should show: `past-due` when payment has lapsed (it outranks the
 * trial), `trial-ending` in the last 3 days of a trial, else none.
 */
export function billingBanner(
  billing: MerchantBillingDto,
  now: Date,
): "trial-ending" | "past-due" | null {
  if (billing.status !== null && PAST_DUE_STATUSES.includes(billing.status)) return "past-due";
  const daysLeft = trialDaysLeft(billing.trialEndsAt, now);
  if (daysLeft !== null && daysLeft > 0 && daysLeft <= 3) return "trial-ending";
  return null;
}
