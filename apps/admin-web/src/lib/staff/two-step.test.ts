import { beforeEach, describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { staffConflictMessage } from "./errors";
import {
  groupManualKey,
  ownTwoStepConflictKey,
  policyConflict,
  requiresTwoStepConflict,
} from "./two-step";

beforeEach(() => {
  expect.hasAssertions();
});

describe("groupManualKey", () => {
  it("groups in blocks of four, whatever the spacing it was given", () => {
    expect(groupManualKey("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(groupManualKey("JBSW Y3DP EHPK 3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("keeps a short tail whole and never leaves a trailing space", () => {
    expect(groupManualKey("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(groupManualKey("ABCDEFGH")).toBe("ABCD EFGH");
    expect(groupManualKey("ABC")).toBe("ABC");
    expect(groupManualKey("")).toBe("");
  });
});

describe("the server's exact two-step sentences", () => {
  it.each([
    ["That code didn't work. Try again.", "wrongCode"],
    ["Two-step verification is already on", "alreadyOn"],
    ["Two-step verification isn't on", "notOn"],
    ["Your store requires two-step verification, so it can't be turned off", "policyRequired"],
  ] as const)("maps the self-service 409 %j", (message, key) => {
    expect(ownTwoStepConflictKey(message)).toBe(key);
  });

  it("does not map a sentence it does not know", () => {
    expect(ownTwoStepConflictKey("Something else")).toBeNull();
    expect(policyConflict("Something else", en)).toBeNull();
    expect(requiresTwoStepConflict("Something else", en)).toBeNull();
  });

  it.each([
    ["Two-step sign-in isn't available on this server yet", "unavailable"],
    ["Turn on two-step verification for your own account first", "selfFirst"],
    ["Everyone needs two-step verification turned on first", "everyoneFirst"],
    ["Revoke or wait for pending invitations first", "pendingInvitations"],
  ] as const)("maps the policy refusal %j in both locales", (message, key) => {
    expect(policyConflict(message, en)).toBe(en.usersPolicy.errors[key]);
    expect(policyConflict(message, ar)).toBe(ar.usersPolicy.errors[key]);
  });

  it("maps the 1d refusals under the policy through the staff conflict map too", () => {
    const invite =
      "Your store requires two-step verification. Turn that off before inviting people";
    const reactivate =
      "Your store requires two-step verification. Turn that off before reactivating people";
    expect(staffConflictMessage(invite, en)).toBe(en.users.errors.requiresTwoStepInvite);
    expect(staffConflictMessage(reactivate, ar)).toBe(ar.users.errors.requiresTwoStepReactivate);
    expect(
      staffConflictMessage(
        "Your store requires two-step verification. Turn that off before dancing",
        en,
      ),
    ).toBeNull();
    // The 1d sentences still map as before.
    expect(staffConflictMessage("A store needs at least one admin", en)).toBe(
      en.users.errors.lastAdmin,
    );
  });
});
