import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";

export interface CarrierSettingsEntryDto {
  readonly key: string;
  readonly displayName: string;
  readonly available: boolean;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly config: Readonly<Record<string, unknown>> | null;
  readonly capabilities: {
    readonly cod: boolean;
    readonly awb: boolean;
    readonly webhooks: boolean;
    readonly cancel: boolean;
  };
  readonly webhookUrl: string | null;
}
export interface CarrierSettingsDto {
  readonly carriers: readonly CarrierSettingsEntryDto[];
  readonly version: number;
}
interface EnabledCarriersDto {
  readonly carriers: readonly { readonly key: string; readonly displayName: string }[];
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isEnabled(value: unknown): value is EnabledCarriersDto {
  return (
    isRecord(value) &&
    Array.isArray(value.carriers) &&
    value.carriers.every(
      (c: unknown) => isRecord(c) && typeof c.key === "string" && typeof c.displayName === "string",
    )
  );
}
function isSettings(value: unknown): value is CarrierSettingsDto {
  return (
    isEnabled(value) &&
    isRecord(value) &&
    typeof value.version === "number" &&
    value.carriers.every((c: unknown) => {
      if (!isRecord(c) || !isRecord(c.capabilities)) return false;
      return (
        typeof c.available === "boolean" &&
        typeof c.enabled === "boolean" &&
        typeof c.configured === "boolean" &&
        (c.config === null || isRecord(c.config)) &&
        (c.webhookUrl === null || typeof c.webhookUrl === "string") &&
        [
          c.capabilities.cod,
          c.capabilities.awb,
          c.capabilities.webhooks,
          c.capabilities.cancel,
        ].every((v) => typeof v === "boolean")
      );
    })
  );
}
export function fetchCarrierSettings(): Promise<ApiResult<CarrierSettingsDto>> {
  return getAdminApi("/api/v1/shipping/carriers", isSettings);
}
export function fetchEnabledCarriers(): Promise<ApiResult<EnabledCarriersDto>> {
  return getAdminApi("/api/v1/shipping/carriers/enabled", isEnabled);
}
export function updateCarrier(
  key: string,
  input: {
    enabled?: boolean;
    credentials?: Record<string, string>;
    config?: Record<string, unknown>;
    disconnect?: true;
  },
  idempotencyKey: string,
): Promise<MutationResult<CarrierSettingsDto>> {
  return mutateAdminApi(
    `/api/v1/shipping/carriers/${encodeURIComponent(key)}`,
    { method: "PUT", body: input, idempotencyKey, timeoutMs: 20_000 },
    isSettings,
  );
}
export function rotateCarrierWebhookSecret(
  key: string,
  idempotencyKey: string,
): Promise<MutationResult<CarrierSettingsDto>> {
  return mutateAdminApi(
    `/api/v1/shipping/carriers/${encodeURIComponent(key)}/webhook-secret`,
    { method: "POST", idempotencyKey, timeoutMs: 20_000 },
    isSettings,
  );
}
