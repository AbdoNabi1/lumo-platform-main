// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type * as StaffClient from "@/lib/api/staff";

const api = vi.hoisted(() => ({
  inviteStaff: vi.fn(),
  resendStaffInvitation: vi.fn(),
  revokeStaffInvitation: vi.fn(),
  changeStaffRole: vi.fn(),
  setStaffActive: vi.fn(),
  setRequireTwoStep: vi.fn(),
  resetStaffTwoStep: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const cookieLocale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof StaffClient>()),
  ...api,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieLocale.value === undefined ? undefined : { value: cookieLocale.value }),
  }),
}));

const {
  changeStaffRoleAction,
  inviteStaffAction,
  resendInvitationAction,
  resetStaffTwoStepAction,
  revokeInvitationAction,
  setRequireTwoStepAction,
  setStaffActiveAction,
} = await import("./actions");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE = "/settings/users";

const failures = [
  ["unauthorized", { outcome: "unauthorized" }, en.formErrors.unauthorized],
  ["forbidden", { outcome: "forbidden" }, en.formErrors.forbidden],
  ["not_found", { outcome: "not_found" }, en.formErrors.notFound],
  ["error", { outcome: "error", message: "boom" }, en.formErrors.unexpected],
  [
    "unknown 409",
    { outcome: "conflict", message: "Idempotency-Key in flight" },
    en.formErrors.conflict,
  ],
] as const;

/** Every action, called with valid arguments, so the same checks run over all five. */
const ACTIONS = [
  [
    "inviteStaffAction",
    api.inviteStaff,
    () => inviteStaffAction({ email: "sam@example.com", role: "viewer" }),
  ],
  ["resendInvitationAction", api.resendStaffInvitation, () => resendInvitationAction("inv-1", 2)],
  ["revokeInvitationAction", api.revokeStaffInvitation, () => revokeInvitationAction("inv-1", 2)],
  ["changeStaffRoleAction", api.changeStaffRole, () => changeStaffRoleAction("p-1", "admin")],
  ["setStaffActiveAction", api.setStaffActive, () => setStaffActiveAction("p-1", false)],
  ["resetStaffTwoStepAction", api.resetStaffTwoStep, () => resetStaffTwoStepAction("p-1")],
] as const;

beforeEach(() => {
  expect.hasAssertions();
  cookieLocale.value = undefined;
});

afterEach(() => {
  vi.resetAllMocks();
});

describe.each(ACTIONS)("%s", (_name, mock, run) => {
  it("sends a fresh Idempotency-Key per invocation", async () => {
    mock.mockResolvedValue({ outcome: "ok", data: {} });
    await run();
    await run();
    const keys = mock.mock.calls.map((call) => call.at(-1) as string);
    expect(keys[0]).toMatch(UUID);
    expect(new Set(keys).size).toBe(2);
  });

  it("revalidates the page after a success", async () => {
    mock.mockResolvedValue({ outcome: "ok", data: {} });
    expect(await run()).toEqual({ status: "success" });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it.each(failures)(
    "revalidates the page after %s too, and reports it in the locale",
    async (_label, result, message) => {
      mock.mockResolvedValue(result);
      const state = await run();
      expect(state).toMatchObject({ status: "error", message });
      expect(revalidatePath).toHaveBeenCalledWith(PAGE);
    },
  );

  it("answers in Arabic when the locale cookie says so", async () => {
    cookieLocale.value = "ar";
    mock.mockResolvedValue({ outcome: "forbidden" });
    expect(await run()).toMatchObject({ status: "error", message: ar.formErrors.forbidden });
  });
});

describe("invitation arguments are checked before the API is reached", () => {
  it.each([
    ["an empty email", { email: "  ", role: "viewer" }],
    ["an unknown role", { email: "a@b.co", role: "owner" }],
    ["an over-long email", { email: `${"a".repeat(330)}@b.co`, role: "viewer" }],
  ])("refuses %s without a request or a revalidation", async (_label, input) => {
    const state = await inviteStaffAction(input as never);
    expect(state).toMatchObject({ status: "error", message: en.formErrors.invalid });
    expect(api.inviteStaff).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("trims the email and sends the chosen role", async () => {
    api.inviteStaff.mockResolvedValue({ outcome: "ok", data: {} });
    await inviteStaffAction({ email: "  Sam@Example.com ", role: "operator" });
    expect(api.inviteStaff.mock.calls[0]?.[0]).toEqual({
      email: "Sam@Example.com",
      role: "operator",
    });
  });

  it.each([
    ["an empty id", () => resendInvitationAction("", 2)],
    ["version 0", () => resendInvitationAction("i", 0)],
    ["a fractional version", () => revokeInvitationAction("i", 1.5)],
    ["an unknown role", () => changeStaffRoleAction("p", "owner" as never)],
    ["a non-boolean active", () => setStaffActiveAction("p", "yes" as never)],
    ["an empty reset id", () => resetStaffTwoStepAction("")],
    ["a non-string reset id", () => resetStaffTwoStepAction(7 as never)],
  ])("refuses %s", async (_label, run) => {
    expect(await run()).toMatchObject({ status: "error", message: en.formErrors.invalid });
    for (const mock of Object.values(api)) expect(mock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the server's exact 409 sentences become the locale's text", () => {
  const SENTENCES: readonly (readonly [string, string, string])[] = [
    [
      "The store owner's role can't be changed",
      en.users.errors.ownerRole,
      ar.users.errors.ownerRole,
    ],
    ["You can't change your own role", en.users.errors.selfRole, ar.users.errors.selfRole],
    ["A store needs at least one admin", en.users.errors.lastAdmin, ar.users.errors.lastAdmin],
    [
      "The store owner can't be deactivated",
      en.users.errors.ownerDeactivate,
      ar.users.errors.ownerDeactivate,
    ],
    [
      "You can't deactivate yourself",
      en.users.errors.selfDeactivate,
      ar.users.errors.selfDeactivate,
    ],
    ["Revoke the invitation instead", en.users.errors.revokeInstead, ar.users.errors.revokeInstead],
    [
      "This person is already on your staff",
      en.users.errors.alreadyStaff,
      ar.users.errors.alreadyStaff,
    ],
    [
      "This email already has a pending invitation",
      en.users.errors.alreadyPending,
      ar.users.errors.alreadyPending,
    ],
    [
      "This email is already used by another store",
      en.users.errors.otherStore,
      ar.users.errors.otherStore,
    ],
    ["This invitation was changed by someone else", en.users.errors.stale, ar.users.errors.stale],
  ];

  it.each(SENTENCES)("%s", async (sentence, english, arabic) => {
    api.changeStaffRole.mockResolvedValue({
      outcome: "conflict",
      message: sentence,
      code: "CONFLICT",
    });
    expect(await changeStaffRoleAction("p-1", "admin")).toEqual({
      status: "error",
      message: english,
      fieldErrors: {},
    });
    cookieLocale.value = "ar";
    expect(await changeStaffRoleAction("p-1", "admin")).toMatchObject({ message: arabic });
  });
});

describe("invitation-specific outcomes", () => {
  it("503 NOT_CONFIGURED: the notice text and the code, and the page is revalidated", async () => {
    api.inviteStaff.mockResolvedValue({
      outcome: "error",
      message: "Admin API responded with status 503",
      code: "NOT_CONFIGURED",
      status: 503,
    });
    expect(await inviteStaffAction({ email: "a@b.co", role: "viewer" })).toEqual({
      status: "error",
      message: "Email isn't set up, so invitations can't be sent.",
      fieldErrors: {},
      code: "NOT_CONFIGURED",
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it("502 EMAIL_FAILED: the code that tells the screen the invitation IS saved", async () => {
    api.inviteStaff.mockResolvedValue({
      outcome: "error",
      message: "Admin API responded with status 502",
      code: "EMAIL_FAILED",
      status: 502,
    });
    expect(await inviteStaffAction({ email: "a@b.co", role: "viewer" })).toMatchObject({
      status: "error",
      code: "EMAIL_FAILED",
      message: en.users.errors.emailFailed,
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it("a 503 or 502 without its code is a plain unexpected error", async () => {
    api.inviteStaff.mockResolvedValue({ outcome: "error", message: "x", status: 503 });
    expect(await inviteStaffAction({ email: "a@b.co", role: "viewer" })).toEqual({
      status: "error",
      message: en.formErrors.unexpected,
      fieldErrors: {},
    });
  });

  it("422 on the email names the field in the locale, never the server's English field text", async () => {
    api.inviteStaff.mockResolvedValue({
      outcome: "invalid",
      message: "Enter a valid email address",
      fields: [{ field: "email", message: "must be a valid email address" }],
    });
    expect(await inviteStaffAction({ email: "nope", role: "viewer" })).toEqual({
      status: "error",
      message: en.users.errors.emailInvalid,
      fieldErrors: { email: en.users.errors.emailInvalid },
    });
  });

  it("422 on anything else is the generic invalid message", async () => {
    api.changeStaffRole.mockResolvedValue({
      outcome: "invalid",
      message: "x",
      fields: [{ field: "role", message: "must be admin, operator or viewer" }],
    });
    expect(await changeStaffRoleAction("p", "admin")).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: {},
    });
  });
});

describe("what each action asks the API for", () => {
  it("passes the loaded version and the ids through unchanged", async () => {
    api.resendStaffInvitation.mockResolvedValue({ outcome: "ok", data: {} });
    api.revokeStaffInvitation.mockResolvedValue({ outcome: "ok", data: {} });
    api.setStaffActive.mockResolvedValue({ outcome: "ok", data: {} });
    api.changeStaffRole.mockResolvedValue({ outcome: "ok", data: {} });
    await resendInvitationAction("inv-9", 4);
    await revokeInvitationAction("inv-9", 5);
    await setStaffActiveAction("p-9", true);
    await changeStaffRoleAction("p-9", "viewer");
    expect(api.resendStaffInvitation.mock.calls[0]?.slice(0, 2)).toEqual(["inv-9", 4]);
    expect(api.revokeStaffInvitation.mock.calls[0]?.slice(0, 2)).toEqual(["inv-9", 5]);
    expect(api.setStaffActive.mock.calls[0]?.slice(0, 2)).toEqual(["p-9", true]);
    expect(api.changeStaffRole.mock.calls[0]?.slice(0, 2)).toEqual(["p-9", "viewer"]);
  });
});

describe("setRequireTwoStepAction (Wave 1e)", () => {
  const ACTIVITY = "/settings/users/activity";

  it("sends the flag with a fresh Idempotency-Key and revalidates the page AND the activity page", async () => {
    api.setRequireTwoStep.mockResolvedValue({ outcome: "ok", data: { requireTwoStep: true } });
    expect(await setRequireTwoStepAction(true)).toEqual({ status: "success" });
    await setRequireTwoStepAction(false);
    expect(api.setRequireTwoStep.mock.calls[0]?.[0]).toBe(true);
    expect(api.setRequireTwoStep.mock.calls[1]?.[0]).toBe(false);
    const keys = api.setRequireTwoStep.mock.calls.map((call) => call[1] as string);
    expect(keys[0]).toMatch(UUID);
    expect(new Set(keys).size).toBe(2);
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
    expect(revalidatePath).toHaveBeenCalledWith(ACTIVITY);
  });

  it.each([
    ["Two-step sign-in isn't available on this server yet", en.usersPolicy.errors.unavailable],
    ["Turn on two-step verification for your own account first", en.usersPolicy.errors.selfFirst],
    ["Everyone needs two-step verification turned on first", en.usersPolicy.errors.everyoneFirst],
    ["Revoke or wait for pending invitations first", en.usersPolicy.errors.pendingInvitations],
  ])("maps the exact 409 %j and still revalidates", async (message, expected) => {
    api.setRequireTwoStep.mockResolvedValue({ outcome: "conflict", message });
    expect(await setRequireTwoStepAction(true)).toEqual({
      status: "error",
      message: expected,
      fieldErrors: {},
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
    expect(revalidatePath).toHaveBeenCalledWith(ACTIVITY);
  });

  it("reads the Arabic mapping from the locale cookie", async () => {
    cookieLocale.value = "ar";
    api.setRequireTwoStep.mockResolvedValue({
      outcome: "conflict",
      message: "Everyone needs two-step verification turned on first",
    });
    expect(await setRequireTwoStepAction(true)).toMatchObject({
      message: ar.usersPolicy.errors.everyoneFirst,
    });
  });

  it("an unknown 409 is the generic try-again, never the raw text", async () => {
    api.setRequireTwoStep.mockResolvedValue({ outcome: "conflict", message: "Some new sentence" });
    expect(await setRequireTwoStepAction(true)).toMatchObject({ message: en.formErrors.conflict });
  });

  it.each(failures)(
    "revalidates after %s too, and reports it in the locale",
    async (_name, result, message) => {
      api.setRequireTwoStep.mockResolvedValue(result);
      expect(await setRequireTwoStepAction(true)).toMatchObject({ status: "error", message });
      expect(revalidatePath).toHaveBeenCalledWith(PAGE);
      expect(revalidatePath).toHaveBeenCalledWith(ACTIVITY);
    },
  );

  it("refuses a non-boolean without calling the API", async () => {
    expect(await setRequireTwoStepAction("yes" as unknown as boolean)).toMatchObject({
      status: "error",
      message: en.formErrors.invalid,
    });
    expect(api.setRequireTwoStep).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the 1d staff commands under the two-step policy (Wave 1e)", () => {
  it("map the 'requires two-step' refusals of inviting and reactivating to the locale", async () => {
    api.inviteStaff.mockResolvedValue({
      outcome: "conflict",
      message: "Your store requires two-step verification. Turn that off before inviting people",
    });
    expect(await inviteStaffAction({ email: "sam@example.com", role: "viewer" })).toMatchObject({
      message: en.users.errors.requiresTwoStepInvite,
    });
    api.setStaffActive.mockResolvedValue({
      outcome: "conflict",
      message:
        "Your store requires two-step verification. Turn that off before reactivating people",
    });
    cookieLocale.value = "ar";
    expect(await setStaffActiveAction("p-1", true)).toMatchObject({
      message: ar.users.errors.requiresTwoStepReactivate,
    });
  });

  it("every write also refreshes the activity page", async () => {
    api.changeStaffRole.mockResolvedValue({ outcome: "ok", data: {} });
    await changeStaffRoleAction("p-1", "admin");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/users/activity");
  });
});

describe("resetStaffTwoStepAction (Wave 1f)", () => {
  const ACTIVITY = "/settings/users/activity";

  it("sends the member's id with an Idempotency-Key and revalidates the table and the activity page", async () => {
    api.resetStaffTwoStep.mockResolvedValue({ outcome: "ok", data: { reset: true } });
    expect(await resetStaffTwoStepAction("pid-mona")).toEqual({ status: "success" });
    expect(api.resetStaffTwoStep.mock.calls[0]?.[0]).toBe("pid-mona");
    expect(api.resetStaffTwoStep.mock.calls[0]?.[1]).toMatch(UUID);
    expect(revalidatePath.mock.calls.map((call) => call[0])).toEqual([PAGE, ACTIVITY]);
  });

  it.each([
    ["forbidden", { outcome: "forbidden" }],
    ["not_found", { outcome: "not_found" }],
    ["unauthorized", { outcome: "unauthorized" }],
    ["error", { outcome: "error", message: "boom" }],
    ["conflict", { outcome: "conflict", message: "Something else" }],
  ])(
    "revalidates both pages on every outcome that reached the API (%s)",
    async (_label, result) => {
      api.resetStaffTwoStep.mockResolvedValue(result);
      expect(await resetStaffTwoStepAction("pid-mona")).toMatchObject({ status: "error" });
      expect(revalidatePath.mock.calls.map((call) => call[0])).toEqual([PAGE, ACTIVITY]);
    },
  );

  it.each([
    [
      "The store owner's two-step verification can't be reset",
      en.users.errors.ownerTwoStepReset,
      ar.users.errors.ownerTwoStepReset,
    ],
    [
      "Reset your own two-step from your account page",
      en.users.errors.selfTwoStepReset,
      ar.users.errors.selfTwoStepReset,
    ],
    ["Revoke the invitation instead", en.users.errors.revokeInstead, ar.users.errors.revokeInstead],
  ])("maps the server's exact sentence %j to the locale", async (message, english, arabic) => {
    api.resetStaffTwoStep.mockResolvedValue({ outcome: "conflict", message });
    expect(await resetStaffTwoStepAction("pid-mona")).toMatchObject({
      status: "error",
      message: english,
    });
    cookieLocale.value = "ar";
    expect(await resetStaffTwoStepAction("pid-mona")).toMatchObject({
      status: "error",
      message: arabic,
    });
    expect(arabic).not.toBe(english);
  });
});

describe("the platform rule's 409 on the policy switch (Wave 1f)", () => {
  it("maps the exact sentence to the locale, never the raw text", async () => {
    api.setRequireTwoStep.mockResolvedValue({
      outcome: "conflict",
      code: "TWO_STEP_REQUIRED",
      message: "Two-step verification is required for everyone on Morbeh",
    });
    expect(await setRequireTwoStepAction(false)).toMatchObject({
      status: "error",
      message: en.usersPolicy.errors.platformRequired,
    });
    cookieLocale.value = "ar";
    expect(await setRequireTwoStepAction(true)).toMatchObject({
      status: "error",
      message: ar.usersPolicy.errors.platformRequired,
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });
});
