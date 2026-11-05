import {
  escapeRichText,
  normalizePlainText,
  type Locale,
  type PolicyType,
} from "@platform/storefront-content";
import * as ar from "./ar";
import * as en from "./en";
import { countPhrase, rangePhrase } from "./plurals";
import type { PolicyTemplateInputs } from "./template-inputs";

const BY_LOCALE = { ar, en } as const;
const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** A merchant value as Morbeh text: single line, every marker escaped. Never starts a line. */
const merchantValue = (value: string): string => escapeRichText(normalizePlainText(value));

/**
 * The starting text for one policy (spec 2.3). The result goes into the editor and is never saved
 * by itself (decision 41). Only the email, phone and address lines are dropped when empty; the
 * store name and `{contact}` fall back to a sentence, so no paragraph loses its subject.
 */
export function renderPolicyTemplate(
  type: PolicyType,
  locale: Locale,
  inputs: PolicyTemplateInputs,
): string {
  const { TEMPLATES, SENTENCES } = BY_LOCALE[locale];
  const email = merchantValue(inputs.contactEmail);
  const phone = merchantValue(inputs.contactPhone);
  const contact = [email, phone].filter((part) => part !== "").join(SENTENCES.or);
  const storeName = merchantValue(inputs.storeName);
  const values: Readonly<Record<string, string>> = {
    storeName: storeName === "" ? SENTENCES.throughStore : storeName,
    email,
    phone,
    address: merchantValue(inputs.businessAddress),
    contact: contact === "" ? SENTENCES.throughStore : contact,
    returnWindow: countPhrase(locale, "day", inputs.returnWindowDays),
    deliveryRange: rangePhrase(locale, inputs.deliveryDays.min, inputs.deliveryDays.max),
    returnShipping: SENTENCES.returnShipping[inputs.returnShippingPaidBy],
    refundMethod: SENTENCES.refundMethod[inputs.refundMethod],
    cod: SENTENCES.cod[inputs.cashOnDelivery ? "yes" : "no"],
    international: SENTENCES.international[inputs.shipsInternationally ? "yes" : "no"],
  };
  const kept = TEMPLATES[type].split("\n").filter((line) => {
    for (const match of line.matchAll(PLACEHOLDER)) {
      if (values[match[1] ?? ""] === "") return false;
    }
    return true;
  });
  // A contact policy with no value at all would be a bare heading: say so instead.
  if (type === "contact" && kept.every((line) => !line.startsWith("- "))) {
    kept.push("", SENTENCES.noContactDetails);
  }
  return kept
    .join("\n")
    .replace(PLACEHOLDER, (_whole, name: string) => values[name] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
