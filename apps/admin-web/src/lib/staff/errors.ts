import type { Dictionary } from "@/messages/en";
import { requiresTwoStepConflict } from "./two-step";

/**
 * The server's exact, user-facing 409 sentences (Security's staff commands and the staff controller),
 * mapped to the locale's own text. The English sentence is the key because the API sends no code of
 * its own for them (every one is `CONFLICT` or `BUSINESS_RULE`). An unknown 409 gets the generic
 * "try again"; nothing the server says is ever shown raw.
 */
const CONFLICT_KEYS: Readonly<Record<string, keyof Dictionary["users"]["errors"]>> = {
  "The store owner's role can't be changed": "ownerRole",
  "You can't change your own role": "selfRole",
  "A store needs at least one admin": "lastAdmin",
  "The store owner can't be deactivated": "ownerDeactivate",
  "You can't deactivate yourself": "selfDeactivate",
  "Revoke the invitation instead": "revokeInstead",
  "This person is already on your staff": "alreadyStaff",
  "This email already has a pending invitation": "alreadyPending",
  "This email is already used by another store": "otherStore",
  "This invitation was changed by someone else": "stale",
  "Only a pending invitation can be resent": "notPending",
  "Only a pending invitation can be revoked": "notPending",
};

/** The locale's text for a 409 `message`, or `null` when this is not one of the known sentences. */
export function staffConflictMessage(message: string, t: Dictionary): string | null {
  const key = CONFLICT_KEYS[message];
  return key === undefined ? requiresTwoStepConflict(message, t) : t.users.errors[key];
}
