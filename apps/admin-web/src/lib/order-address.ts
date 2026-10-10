import type { Locale } from "./i18n";

/** The parts of an order address the order page shows, copies, and sends to a map. */
export interface AddressParts {
  readonly recipientName: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

/**
 * A country's name in the page locale ("Egypt" / "مصر"), from its region code via
 * `Intl.DisplayNames`. Anything that is not a two-letter region code — or a code the runtime does not
 * know — is shown as it was recorded, never blanked or invented.
 */
export function countryName(country: string, locale: Locale): string {
  if (!/^[A-Za-z]{2}$/.test(country)) return country;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(country.toUpperCase()) ?? country;
  } catch {
    return country;
  }
}

/** The address as it reads on the page, one entry per line. Absent parts leave no blank line. */
export function addressLines(address: AddressParts, locale: Locale): string[] {
  return [
    address.recipientName,
    address.line1,
    address.line2,
    [address.city, address.postalCode].filter((part) => part !== "").join(", "),
    countryName(address.country, locale),
    address.phone,
  ].filter((line): line is string => line !== null && line !== "");
}

/** What the Copy button puts on the clipboard: the lines above, one per row. */
export function addressForClipboard(address: AddressParts, locale: Locale): string {
  return addressLines(address, locale).join("\n");
}

/**
 * A Google Maps search for where the order is going. Only the delivery address goes in the URL — never
 * the recipient's name or phone — and the country is named in English whatever the page language, which
 * is what the map places best. The query is encoded by `URLSearchParams`, so nothing in a street name
 * can add a parameter.
 */
export function mapSearchUrl(address: AddressParts): string {
  const query = [
    address.line1,
    address.line2,
    address.city,
    address.postalCode,
    countryName(address.country, "en"),
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
  const params = new URLSearchParams({ api: "1", query });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
