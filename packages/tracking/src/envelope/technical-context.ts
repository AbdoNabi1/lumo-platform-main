/**
 * Technical/device block (doc 16 §6.3). Populated by the edge collector, which is the only place
 * that legitimately sees the client IP and raw user agent. `clientIpAddress` and
 * `clientUserAgent` are required by every conversions API for match quality, so they are carried
 * — but they are PII under GDPR and are subject to the same consent gate as any other identifier.
 */
export interface TechnicalContext {
  readonly clientIpAddress?: string;
  readonly clientUserAgent?: string;

  readonly browserLanguage?: string;
  readonly browserName?: string;
  readonly browserVersion?: string;

  readonly deviceType?: DeviceType;
  readonly deviceBrand?: string;
  readonly deviceModel?: string;

  readonly osName?: string;
  readonly osVersion?: string;

  readonly screenResolution?: string;
  readonly viewport?: string;
  readonly timezone?: string;

  readonly connectionType?: string;
  readonly networkType?: string;

  /** Geo derived from the IP at the edge — never stored as raw IP downstream. */
  readonly countryDetected?: string;
  readonly regionDetected?: string;
  readonly cityDetected?: string;
}

export type DeviceType = "desktop" | "mobile" | "tablet" | "tv" | "wearable" | "bot" | "unknown";

export const DEVICE_TYPES: readonly DeviceType[] = [
  "desktop",
  "mobile",
  "tablet",
  "tv",
  "wearable",
  "bot",
  "unknown",
];

export function isDeviceType(value: string): value is DeviceType {
  return (DEVICE_TYPES as readonly string[]).includes(value);
}
