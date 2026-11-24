import { characterCount } from "../domain/customer-annotations";
import {
  isCustomerLanguage,
  type CustomerLanguage,
} from "../domain/value-objects/customer-language";
import { Phone } from "../domain/value-objects/phone";

export interface ProfileFields {
  readonly name?: string;
  readonly phone?: string | null;
  readonly language?: CustomerLanguage | null;
}

export function validateProfile(
  input: { name?: unknown; phone?: unknown; language?: unknown },
  mode: "create" | "update",
): {
  readonly value: ProfileFields;
  readonly issues: readonly { field: string; message: string }[];
} {
  const value: { name?: string; phone?: string | null; language?: CustomerLanguage | null } = {};
  const issues: { field: string; message: string }[] = [];
  if (input.name !== undefined || mode === "create") {
    if (
      typeof input.name !== "string" ||
      characterCount(input.name.trim()) < 1 ||
      characterCount(input.name.trim()) > 255
    ) {
      issues.push({ field: "name", message: "must be 1 to 255 characters" });
    } else value.name = input.name.trim();
  }
  if (input.phone !== undefined) {
    if (input.phone === null || (typeof input.phone === "string" && input.phone.trim() === "")) {
      if (mode === "update") value.phone = null;
    } else if (typeof input.phone !== "string") {
      issues.push({
        field: "phone",
        message: "must be 7 to 15 digits, optionally starting with +",
      });
    } else {
      const phone = Phone.create(input.phone);
      if (phone.ok) value.phone = phone.value.value;
      else
        issues.push({
          field: "phone",
          message: "must be 7 to 15 digits, optionally starting with +",
        });
    }
  }
  if (input.language !== undefined) {
    if (input.language === null || isCustomerLanguage(input.language))
      value.language = input.language;
    else issues.push({ field: "language", message: "must be en or ar" });
  }
  if (
    mode === "update" &&
    input.name === undefined &&
    input.phone === undefined &&
    input.language === undefined
  ) {
    issues.push({ field: "body", message: "provide at least one field" });
  }
  return { value, issues };
}
