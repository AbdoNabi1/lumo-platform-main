import type { Dictionary } from "@/messages/en";

/** Mirrors CARRIER_KEY_PATTERN in shipping's carrier-key value object. */
export const CARRIER_KEY = /^[a-z][a-z0-9_-]{1,31}$/;

export function carrierErrorMessage(code: string | undefined, t: Dictionary): string {
  switch (code) {
    case "CARRIER_CREDENTIALS_REJECTED":
      return t.carrierSettings.credentialsRejected;
    case "CARRIER_UNAVAILABLE":
      return t.carrierSettings.unavailable;
    case "CARRIER_NOT_AVAILABLE":
      return t.carrierSettings.notAvailable;
    case "CARRIER_NOT_CONFIGURED":
      return t.carrierSettings.notConfigured;
    default:
      return t.formErrors.unexpected;
  }
}
