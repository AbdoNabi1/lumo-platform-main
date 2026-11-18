export type SignupCountry = "EG" | "SA" | "AE";

/** Project 1: launch countries and the store defaults each implies (spec §2 step 7). */
export const COUNTRY_DEFAULTS: Readonly<
  Record<SignupCountry, { readonly currency: string; readonly timezone: string }>
> = Object.freeze({
  EG: { currency: "EGP", timezone: "Africa/Cairo" },
  SA: { currency: "SAR", timezone: "Asia/Riyadh" },
  AE: { currency: "AED", timezone: "Asia/Dubai" },
});
