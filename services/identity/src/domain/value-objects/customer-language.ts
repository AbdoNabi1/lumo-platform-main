export type CustomerLanguage = "en" | "ar";
export function isCustomerLanguage(v: unknown): v is CustomerLanguage {
  return v === "en" || v === "ar";
}
