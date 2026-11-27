export interface BostaWebhook {
  readonly trackingNumber: string;
  readonly state: number;
  readonly type?: string;
  readonly timeStamp?: number;
  readonly exceptionReason?: string;
  readonly exceptionCode?: number;
  readonly businessReference?: string;
  readonly cod?: number;
  readonly numberOfAttempts?: number;
}

export const BOSTA_WEBHOOK_MAX_BYTES = 16_384;

export function parseBostaWebhook(raw: Uint8Array): BostaWebhook | null {
  if (raw.byteLength > BOSTA_WEBHOOK_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const tracking = value.trackingNumber;
  if (
    typeof tracking !== "string" &&
    !(typeof tracking === "number" && Number.isSafeInteger(tracking))
  )
    return null;
  const trackingNumber = String(tracking);
  if (
    !/^[A-Za-z0-9-]{1,32}$/.test(trackingNumber) ||
    typeof value.state !== "number" ||
    !Number.isInteger(value.state)
  )
    return null;
  return {
    trackingNumber,
    state: value.state,
    ...(typeof value.type === "string" && value.type.length <= 40 ? { type: value.type } : {}),
    ...(typeof value.timeStamp === "number" && Number.isFinite(value.timeStamp)
      ? { timeStamp: value.timeStamp }
      : {}),
    ...(typeof value.exceptionReason === "string"
      ? { exceptionReason: value.exceptionReason.slice(0, 200) }
      : {}),
    ...(typeof value.exceptionCode === "number" && Number.isFinite(value.exceptionCode)
      ? { exceptionCode: value.exceptionCode }
      : {}),
    ...(typeof value.businessReference === "string"
      ? { businessReference: value.businessReference }
      : {}),
    ...(typeof value.cod === "number" && Number.isFinite(value.cod) ? { cod: value.cod } : {}),
    ...(typeof value.numberOfAttempts === "number" && Number.isFinite(value.numberOfAttempts)
      ? { numberOfAttempts: value.numberOfAttempts }
      : {}),
  };
}

export function bostaWebhookEventId(webhook: BostaWebhook): string {
  return `${webhook.trackingNumber}:${webhook.state}:${webhook.timeStamp ?? "none"}`;
}
