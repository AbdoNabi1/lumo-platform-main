import { PROVINCES } from "@platform/regions";
import type { BostaConfig } from "./config";
import type { BostaRejectionCode } from "./errors";
import type { BostaCity } from "./governorates";
import { toBostaPhone } from "./phone";

export interface BostaParcel {
  readonly recipient: { readonly name: string; readonly phone: string };
  readonly address: {
    readonly line1: string;
    readonly line2?: string;
    readonly city: string;
    readonly province?: string;
    readonly country: string;
  };
  readonly codAmountMinor: number;
  readonly currency: string;
  readonly itemsCount: number;
  readonly description: string;
  readonly packageImages: readonly string[];
}
export interface BostaProblem {
  readonly code: BostaRejectionCode;
  readonly reason?: string;
}
export const BOSTA_COD_LIMIT_MINOR = 3_000_000;
export const DESCRIPTION_MAX = 200;

function firstLine(parcel: BostaParcel): string {
  return [parcel.address.line1, parcel.address.line2].filter(Boolean).join(", ").trim();
}
function httpsImages(parcel: BostaParcel): string[] {
  return [
    ...new Set(
      parcel.packageImages.filter((image) => {
        try {
          return new URL(image).protocol === "https:";
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, 10);
}

export function checkParcel(parcel: BostaParcel, config: BostaConfig): BostaProblem | null {
  if (parcel.currency !== "EGP") return { code: "CURRENCY_NOT_SUPPORTED" };
  if (!Number.isSafeInteger(parcel.codAmountMinor) || parcel.codAmountMinor < 0)
    return { code: "COD_INVALID" };
  if (parcel.codAmountMinor > BOSTA_COD_LIMIT_MINOR) return { code: "COD_ABOVE_CARRIER_LIMIT" };
  if (parcel.address.country !== "EG")
    return { code: "ADDRESS_NOT_SHIPPABLE", reason: "COUNTRY_NOT_SUPPORTED" };
  if (!parcel.address.province)
    return { code: "ADDRESS_NOT_SHIPPABLE", reason: "PROVINCE_MISSING" };
  if (!PROVINCES.EG?.some((province) => province.code === parcel.address.province))
    return { code: "ADDRESS_NOT_SHIPPABLE", reason: "PROVINCE_UNKNOWN" };
  if (!parcel.address.city.trim())
    return { code: "ADDRESS_NOT_SHIPPABLE", reason: "DISTRICT_MISSING" };
  if (firstLine(parcel).length <= 5)
    return { code: "ADDRESS_NOT_SHIPPABLE", reason: "ADDRESS_LINE_TOO_SHORT" };
  if (!parcel.recipient.name.trim())
    return { code: "ADDRESS_NOT_SHIPPABLE", reason: "RECIPIENT_MISSING" };
  if (toBostaPhone(parcel.recipient.phone) === null) return { code: "PHONE_NOT_SHIPPABLE" };
  if (config.allowToOpenPackage && httpsImages(parcel).length === 0)
    return { code: "OPEN_PACKAGE_NEEDS_IMAGES" };
  return null;
}

export function splitReceiverName(name: string): {
  readonly firstName: string;
  readonly lastName: string;
} {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") || "-" };
}
export function describeItems(description: string): string {
  const trimmed = description.trim();
  return trimmed.length > DESCRIPTION_MAX ? `${trimmed.slice(0, DESCRIPTION_MAX - 1)}…` : trimmed;
}
export function buildDeliveryPayload(input: {
  readonly parcel: BostaParcel;
  readonly reference: string;
  readonly city: BostaCity;
  readonly config: BostaConfig;
  readonly webhookUrl: string | null;
  readonly webhookHeaders: Readonly<Record<string, string>>;
}): Record<string, unknown> {
  const { parcel, reference, city, config, webhookUrl, webhookHeaders } = input;
  return {
    type: 10,
    specs: {
      packageType: "Parcel",
      size: "SMALL",
      packageDetails: {
        itemsCount: parcel.itemsCount,
        description: describeItems(parcel.description),
      },
    },
    cod: parcel.codAmountMinor / 100,
    dropOffAddress: {
      city: city.name,
      cityId: city._id,
      districtName: parcel.address.city.trim(),
      firstLine: firstLine(parcel),
    },
    receiver: {
      ...splitReceiverName(parcel.recipient.name),
      phone: toBostaPhone(parcel.recipient.phone),
    },
    businessReference: reference,
    uniqueBusinessReference: reference,
    allowToOpenPackage: config.allowToOpenPackage,
    ...(config.allowToOpenPackage
      ? { deliveryImages: [{ type: "ALLOW_TO_OPEN_THE_PACKAGE", images: httpsImages(parcel) }] }
      : {}),
    escrowInfo: { isExcluded: true },
    ...(webhookUrl !== null ? { webhookUrl, webhookCustomHeaders: webhookHeaders } : {}),
  };
}
