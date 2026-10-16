import { isCurrencyCode } from "./currencies";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export const WEIGHT_UNITS = ["kg", "g", "lb", "oz"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const MAX_STORE_NAME_LENGTH = 120;

export interface StoreSettingsInput {
  readonly storeName: string;
  readonly contactEmail: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly weightUnit: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AREA_CITY = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/;

function isTimeZone(value: string): boolean {
  if (value === "UTC") return true;
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone").includes(value);
  }
  return AREA_CITY.test(value);
}

/**
 * Shopify's Settings → General for one shop: name, contact email, the store currency (every price is
 * in it), time zone and weight unit. One row per shop, so there is no id and no version; a change is a
 * whole-value replace. Defaults apply until the merchant saves (an unnamed Egyptian store in kg).
 */
export class StoreSettings {
  readonly storeName: string;
  readonly contactEmail: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly weightUnit: WeightUnit;

  private constructor(props: {
    storeName: string;
    contactEmail: string | null;
    currency: string;
    timezone: string;
    weightUnit: WeightUnit;
  }) {
    this.storeName = props.storeName;
    this.contactEmail = props.contactEmail;
    this.currency = props.currency;
    this.timezone = props.timezone;
    this.weightUnit = props.weightUnit;
  }

  static defaults(): StoreSettings {
    return new StoreSettings({
      storeName: "",
      contactEmail: null,
      currency: "EGP",
      timezone: "Africa/Cairo",
      weightUnit: "kg",
    });
  }

  static create(input: StoreSettingsInput): Result<StoreSettings, ValidationError> {
    const issues: { field: string; message: string }[] = [];
    const storeName = input.storeName.trim();
    const email = input.contactEmail?.trim() ?? "";
    if (storeName.length > MAX_STORE_NAME_LENGTH) {
      issues.push({
        field: "storeName",
        message: `must be at most ${MAX_STORE_NAME_LENGTH} characters`,
      });
    }
    if (email.length > 0 && !EMAIL.test(email)) {
      issues.push({ field: "contactEmail", message: "must be a valid email address" });
    }
    if (!isCurrencyCode(input.currency)) {
      issues.push({ field: "currency", message: "must be an ISO 4217 currency code" });
    }
    if (!isTimeZone(input.timezone)) {
      issues.push({ field: "timezone", message: "must be an IANA time zone" });
    }
    if (!(WEIGHT_UNITS as readonly string[]).includes(input.weightUnit)) {
      issues.push({ field: "weightUnit", message: "must be one of kg, g, lb or oz" });
    }
    if (issues.length > 0) return err(new ValidationError("Invalid store settings", issues));
    return ok(
      new StoreSettings({
        storeName,
        contactEmail: email.length === 0 ? null : email,
        currency: input.currency,
        timezone: input.timezone,
        weightUnit: input.weightUnit as WeightUnit,
      }),
    );
  }
}
