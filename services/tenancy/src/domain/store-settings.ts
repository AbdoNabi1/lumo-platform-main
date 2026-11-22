import { isCurrencyCode } from "./currencies";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export const WEIGHT_UNITS = ["kg", "g", "lb", "oz"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** What the shop is for: an online store, or a lead website (no cart/checkout). Fixed at sign-up. */
export const SITE_TYPES = ["store", "lead_site"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export function isSiteType(value: unknown): value is SiteType {
  return typeof value === "string" && (SITE_TYPES as readonly string[]).includes(value);
}

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
  /** When the merchant dismissed Home's setup guide; `null` while it is still showing. */
  readonly setupGuideDismissedAt: Date | null;
  /** Chosen at sign-up and never changed afterwards; persistence only writes it when settling. */
  readonly siteType: SiteType;

  private constructor(props: {
    storeName: string;
    contactEmail: string | null;
    currency: string;
    timezone: string;
    weightUnit: WeightUnit;
    setupGuideDismissedAt: Date | null;
    siteType: SiteType;
  }) {
    this.storeName = props.storeName;
    this.contactEmail = props.contactEmail;
    this.currency = props.currency;
    this.timezone = props.timezone;
    this.weightUnit = props.weightUnit;
    this.setupGuideDismissedAt = props.setupGuideDismissedAt;
    this.siteType = props.siteType;
  }

  static defaults(): StoreSettings {
    return new StoreSettings({
      storeName: "",
      contactEmail: null,
      currency: "EGP",
      timezone: "Africa/Cairo",
      weightUnit: "kg",
      setupGuideDismissedAt: null,
      siteType: "store",
    });
  }

  /**
   * A copy with another site type, for restoring a stored row only. Persistence ignores the field
   * except in `settleSignupSiteType`, so this can never change a shop's type.
   */
  withSiteType(siteType: SiteType): StoreSettings {
    return new StoreSettings({
      storeName: this.storeName,
      contactEmail: this.contactEmail,
      currency: this.currency,
      timezone: this.timezone,
      weightUnit: this.weightUnit,
      setupGuideDismissedAt: this.setupGuideDismissedAt,
      siteType,
    });
  }

  /** Marks the setup guide dismissed at `at`; an already-dismissed value keeps its first timestamp. */
  withSetupGuideDismissed(at: Date): StoreSettings {
    if (this.setupGuideDismissedAt !== null) return this;
    return this.withSetupGuideDismissedAt(at);
  }

  /** A copy with the dismissal set to `at` (or cleared with `null`); every other field is kept. */
  withSetupGuideDismissedAt(at: Date | null): StoreSettings {
    return new StoreSettings({
      storeName: this.storeName,
      contactEmail: this.contactEmail,
      currency: this.currency,
      timezone: this.timezone,
      weightUnit: this.weightUnit,
      setupGuideDismissedAt: at,
      siteType: this.siteType,
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
        setupGuideDismissedAt: null,
        siteType: "store",
      }),
    );
  }
}
