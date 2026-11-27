import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { staffConflictMessage } from "./errors";

const EXACT: readonly (readonly [string, keyof typeof en.users.errors])[] = [
  ["The store owner's role can't be changed", "ownerRole"],
  ["You can't change your own role", "selfRole"],
  ["A store needs at least one admin", "lastAdmin"],
  ["The store owner can't be deactivated", "ownerDeactivate"],
  ["You can't deactivate yourself", "selfDeactivate"],
  ["Revoke the invitation instead", "revokeInstead"],
  ["This person is already on your staff", "alreadyStaff"],
  ["This email already has a pending invitation", "alreadyPending"],
  ["This email is already used by another store", "otherStore"],
  ["This invitation was changed by someone else", "stale"],
  ["Only a pending invitation can be resent", "notPending"],
  ["Only a pending invitation can be revoked", "notPending"],
  ["The store owner's two-step verification can't be reset", "ownerTwoStepReset"],
  ["Reset your own two-step from your account page", "selfTwoStepReset"],
];

describe("staffConflictMessage", () => {
  it.each(EXACT)("maps the server's exact sentence %j to the locale text", (sentence, key) => {
    expect.hasAssertions();
    expect(staffConflictMessage(sentence, en)).toBe(en.users.errors[key]);
    expect(staffConflictMessage(sentence, ar)).toBe(ar.users.errors[key]);
    expect(ar.users.errors[key]).not.toBe(en.users.errors[key]);
  });

  it("returns null for any other sentence, so the caller shows the generic one", () => {
    expect.hasAssertions();
    expect(staffConflictMessage("Something else", en)).toBeNull();
    expect(staffConflictMessage("", en)).toBeNull();
    // Only the exact sentence counts: no prefix or case-insensitive match.
    expect(staffConflictMessage("a store needs at least one admin", en)).toBeNull();
  });
});
