import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export const AD_PLATFORMS = ["meta", "tiktok", "snap", "ga4", "google_ads"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];
export const SERVER_PLATFORMS = [
  "meta",
  "tiktok",
  "snap",
  "ga4",
] as const satisfies readonly AdPlatform[];
export type PublicConfig =
  | { readonly platform: "meta"; readonly pixelId: string }
  | { readonly platform: "tiktok"; readonly pixelCode: string }
  | { readonly platform: "snap"; readonly pixelId: string }
  | { readonly platform: "ga4"; readonly measurementId: string }
  | {
      readonly platform: "google_ads";
      readonly conversionId: string;
      readonly labels: {
        readonly lead?: string;
        readonly contact?: string;
        readonly purchase?: string;
      };
    };
export const PUBLIC_ID_PATTERNS = {
  metaPixelId: /^\d{8,20}$/,
  tiktokPixelCode: /^[A-Z0-9]{10,30}$/,
  snapPixelId: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  ga4MeasurementId: /^G-[A-Z0-9]{4,20}$/,
  googleAdsConversionId: /^AW-\d{6,15}$/,
  googleAdsLabel: /^[A-Za-z0-9_-]{1,64}$/,
  testEventCode: /^[A-Za-z0-9_-]{1,64}$/,
} as const;
export const SECRET_RULE = { min: 10, max: 1024, pattern: /^[A-Za-z0-9._~+/=:|-]+$/ } as const;
export interface ConnectionProps {
  readonly id: string;
  readonly platform: AdPlatform;
  readonly enabled: boolean;
  readonly publicConfig: PublicConfig | null;
  readonly sealedSecret: string | null;
  readonly secretLast4: string | null;
  readonly testEventCode: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export class Connection {
  private constructor(readonly props: ConnectionProps) {}
  static restore(props: ConnectionProps): Connection {
    return new Connection(props);
  }
  isComplete(): boolean {
    return (
      this.props.publicConfig !== null &&
      (this.props.platform === "google_ads" || this.props.sealedSecret !== null)
    );
  }
  isLive(): boolean {
    return this.props.enabled && this.isComplete();
  }
}
function invalid(field: string): Result<never, ValidationError> {
  return err(
    new ValidationError("Invalid public configuration", [
      { field: `publicConfig.${field}`, message: "invalid value" },
    ]),
  );
}
export function validatePublicConfig(
  platform: AdPlatform,
  raw: unknown,
): Result<PublicConfig, ValidationError> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalid("platform");
  const value = raw as Record<string, unknown>;
  if (value.platform !== undefined && value.platform !== platform) return invalid("platform");
  if (platform === "google_ads") {
    if (
      typeof value.conversionId !== "string" ||
      !PUBLIC_ID_PATTERNS.googleAdsConversionId.test(value.conversionId)
    )
      return invalid("conversionId");
    const labels = value.labels ?? {};
    if (typeof labels !== "object" || labels === null || Array.isArray(labels))
      return invalid("labels");
    const result: { lead?: string; contact?: string; purchase?: string } = {};
    for (const key of ["lead", "contact", "purchase"] as const) {
      const label: unknown = (labels as Record<string, unknown>)[key];
      if (label !== undefined) {
        if (typeof label !== "string" || !PUBLIC_ID_PATTERNS.googleAdsLabel.test(label))
          return invalid(`labels.${key}`);
        result[key] = label;
      }
    }
    return ok({ platform, conversionId: value.conversionId, labels: result });
  }
  if (platform === "meta" || platform === "snap") {
    const pattern =
      platform === "meta" ? PUBLIC_ID_PATTERNS.metaPixelId : PUBLIC_ID_PATTERNS.snapPixelId;
    if (typeof value.pixelId !== "string" || !pattern.test(value.pixelId))
      return invalid("pixelId");
    return ok({ platform, pixelId: value.pixelId });
  }
  if (platform === "tiktok") {
    if (
      typeof value.pixelCode !== "string" ||
      !PUBLIC_ID_PATTERNS.tiktokPixelCode.test(value.pixelCode)
    )
      return invalid("pixelCode");
    return ok({ platform, pixelCode: value.pixelCode });
  }
  if (
    typeof value.measurementId !== "string" ||
    !PUBLIC_ID_PATTERNS.ga4MeasurementId.test(value.measurementId)
  )
    return invalid("measurementId");
  return ok({ platform, measurementId: value.measurementId });
}
