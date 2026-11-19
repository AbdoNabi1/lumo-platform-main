import type { ContentIssue } from "./locale";

/** The result of a write-path validator: the stored value, or every issue found. */
export type ValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] };
