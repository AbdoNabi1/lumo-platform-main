import type { Dictionary } from "@/messages/en";

/** The merchant-facing name of a carrier: Bosta reads «بوسطة» in Arabic, others show as recorded. */
export function carrierLabel(key: string, displayName: string, t: Dictionary): string {
  return key === "bosta" ? t.carrierSettings.carrierBosta : displayName;
}
