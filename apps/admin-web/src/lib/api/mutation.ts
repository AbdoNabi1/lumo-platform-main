import { randomUUID } from "node:crypto";
import type { FieldIssue, MutationResult } from "./client";

/** A fresh Idempotency-Key for one user-initiated submit. Server-only (`node:crypto`). */
export function newIdempotencyKey(): string {
  return randomUUID();
}

/** The `formErrors` section of the dictionary — every write form shares the same generic messages. */
export type FormErrorDictionary = {
  readonly unauthorized: string;
  readonly forbidden: string;
  readonly notFound: string;
  readonly conflict: string;
  readonly invalid: string;
  readonly unexpected: string;
};

/** What a form renders after a submit. `fieldErrors` is keyed by input name. */
export type FormState =
  | { readonly status: "idle" }
  | { readonly status: "success" }
  | {
      readonly status: "error";
      /** A single sentence to show above the form. */
      readonly message: string;
      /** Per-input messages, keyed by the field name the API reported. */
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

function fieldErrorsOf(fields: readonly FieldIssue[]): {
  readonly fieldErrors: Record<string, string>;
  readonly topLevelMessages: readonly string[];
} {
  const fieldErrors: Record<string, string> = {};
  const topLevelMessages: string[] = [];
  for (const issue of fields) {
    if (issue.field.length === 0) {
      topLevelMessages.push(issue.message);
    } else {
      fieldErrors[issue.field] = issue.message;
    }
  }
  return { fieldErrors, topLevelMessages };
}

/**
 * Projects a `MutationResult` onto the shape a form renders. Message text is looked up by the
 * caller from its own dictionary — this returns a stable key, not English prose, so both locales
 * stay correct. See `messages/en.ts`'s `formErrors` section.
 */
export function toFormState(result: MutationResult<unknown>, t: FormErrorDictionary): FormState {
  switch (result.outcome) {
    case "ok":
      return { status: "success" };
    case "unauthorized":
      return { status: "error", message: t.unauthorized, fieldErrors: {} };
    case "forbidden":
      return { status: "error", message: t.forbidden, fieldErrors: {} };
    case "not_found":
      return { status: "error", message: t.notFound, fieldErrors: {} };
    case "conflict":
      return { status: "error", message: result.message, fieldErrors: {} };
    case "invalid": {
      const { fieldErrors, topLevelMessages } = fieldErrorsOf(result.fields);
      const message = topLevelMessages.length > 0 ? topLevelMessages.join(" ") : t.invalid;
      return { status: "error", message, fieldErrors };
    }
    case "error":
      return { status: "error", message: t.unexpected, fieldErrors: {} };
  }
}
