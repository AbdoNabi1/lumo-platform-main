import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import {
  characterCount,
  MAX_TAGS_PER_CUSTOMER,
  normalizeNote,
  parseTags,
  type CustomerTag,
} from "../domain/customer-annotations";
import {
  isCustomerLanguage,
  type CustomerLanguage,
} from "../domain/value-objects/customer-language";
import { Email } from "../domain/value-objects/email";
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

export interface CreateCustomerFields extends ProfileFields {
  readonly email: Email;
  readonly name: string;
  /** `undefined` = not given; `null` = given but blank. */
  readonly note?: string | null;
  /** `undefined` = not given. */
  readonly tags?: readonly CustomerTag[];
}

/**
 * Everything a create must check, collected into ONE aggregate `ValidationError` so a caller sees
 * every failing field at once and no repository is touched before the input is whole.
 */
export function validateCreateCustomer(input: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  language?: unknown;
  note?: unknown;
  tags?: unknown;
}): Result<CreateCustomerFields, ValidationError> {
  const profile = validateProfile(input, "create");
  const issues: { field: string; message: string }[] = [...profile.issues];

  let email: Email | null = null;
  if (typeof input.email !== "string") {
    issues.push({ field: "email", message: "must be a valid email" });
  } else {
    const parsed = Email.create(input.email);
    if (parsed.ok) email = parsed.value;
    else issues.push({ field: "email", message: "must be a valid email" });
  }

  let note: string | null | undefined;
  if (input.note !== undefined) {
    if (input.note !== null && typeof input.note !== "string") {
      issues.push({ field: "note", message: "must be a string" });
    } else {
      const parsed = normalizeNote(input.note);
      if (parsed.ok) note = parsed.value;
      else
        issues.push({ field: "note", message: parsed.error.fields[0]?.message ?? "invalid note" });
    }
  }

  let tags: readonly CustomerTag[] | undefined;
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string")) {
      issues.push({ field: "tags", message: "must be a list of strings" });
    } else {
      const parsed = parseTags(input.tags as string[]);
      if (!parsed.ok) {
        issues.push({ field: "tags", message: parsed.error.fields[0]?.message ?? "invalid tags" });
      } else if (parsed.value.length > MAX_TAGS_PER_CUSTOMER) {
        issues.push({
          field: "tags",
          message: `must be at most ${MAX_TAGS_PER_CUSTOMER} tags`,
        });
      } else tags = parsed.value;
    }
  }

  if (issues.length > 0 || email === null || profile.value.name === undefined) {
    return err(new ValidationError("Invalid customer", issues));
  }
  return ok({ ...profile.value, name: profile.value.name, email, note, tags });
}

/** The shared update/clear check — `ValidationError("Invalid customer")` or the normalized fields. */
export function validateCustomerUpdate(input: {
  name?: unknown;
  phone?: unknown;
  language?: unknown;
}): { readonly value: ProfileFields; readonly error: ValidationError | null } {
  const { value, issues } = validateProfile(input, "update");
  return {
    value,
    error: issues.length > 0 ? new ValidationError("Invalid customer", issues) : null,
  };
}
