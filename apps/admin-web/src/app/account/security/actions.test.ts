// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  startOwnTwoStep: vi.fn(),
  confirmOwnTwoStep: vi.fn(),
  regenerateBackupCodes: vi.fn(),
  disableOwnTwoStep: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const cookieLocale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/two-step", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieLocale.value === undefined ? undefined : { value: cookieLocale.value }),
  }),
}));

const {
  confirmTwoStepAction,
  disableTwoStepAction,
  regenerateBackupCodesAction,
  startTwoStepAction,
} = await import("./actions");

const PAGE = "/account/security";
const USERS = "/settings/users";
const ACTIVITY = "/settings/users/activity";
const SETUP = {
  enrollmentId: "5b8d3f1e-0000-4000-8000-000000000001",
  manualKey: "JBSWY3DPEHPK3PXP",
  provisioningUri: "otpauth://totp/Morbeh:me%40shop.example?secret=JBSWY3DPEHPK3PXP&issuer=Morbeh",
};
const CODES = ["aaaa-bbbb-cccc", "dddd-eeee-ffff"];

beforeEach(() => {
  expect.hasAssertions();
  cookieLocale.value = undefined;
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("startTwoStepAction", () => {
  it("returns the secret in the result (and only there) and revalidates the page", async () => {
    api.startOwnTwoStep.mockResolvedValue({ outcome: "ok", data: SETUP });
    expect(await startTwoStepAction()).toEqual({ status: "ok", data: SETUP });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
    // The secret never reaches a revalidated path or a URL.
    expect(JSON.stringify(revalidatePath.mock.calls)).not.toContain("JBSWY3DP");
  });

  it("sends no idempotency key (the call takes no arguments at all)", async () => {
    api.startOwnTwoStep.mockResolvedValue({ outcome: "ok", data: SETUP });
    await startTwoStepAction();
    expect(api.startOwnTwoStep).toHaveBeenCalledWith();
  });

  it('503 NOT_CONFIGURED reads "isn\'t set up on this server yet" (en and ar), still revalidating', async () => {
    api.startOwnTwoStep.mockResolvedValue({
      outcome: "error",
      message: "x",
      status: 503,
      code: "NOT_CONFIGURED",
    });
    expect(await startTwoStepAction()).toEqual({
      status: "error",
      reason: "not_configured",
      message: "Two-step verification isn't set up on this server yet.",
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
    cookieLocale.value = "ar";
    const arabic = await startTwoStepAction();
    expect(arabic).toMatchObject({
      reason: "not_configured",
      message: ar.accountSecurity.errors.notConfigured,
    });
  });

  it("a known 409 (already on) and an unknown one", async () => {
    api.startOwnTwoStep.mockResolvedValue({
      outcome: "conflict",
      message: "Two-step verification is already on",
    });
    expect(await startTwoStepAction()).toMatchObject({
      reason: "already_on",
      message: en.accountSecurity.errors.alreadyOn,
    });
    api.startOwnTwoStep.mockResolvedValue({ outcome: "conflict", message: "weird" });
    expect(await startTwoStepAction()).toEqual({
      status: "error",
      reason: "unexpected",
      message: en.formErrors.conflict,
    });
  });
});

describe("confirmTwoStepAction", () => {
  it("returns the backup codes once and revalidates the page, the Users table and the activity page", async () => {
    api.confirmOwnTwoStep.mockResolvedValue({ outcome: "ok", data: { backupCodes: CODES } });
    expect(
      await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: " 123456 " }),
    ).toEqual({ status: "ok", data: { backupCodes: CODES } });
    expect(api.confirmOwnTwoStep).toHaveBeenCalledWith({
      enrollmentId: SETUP.enrollmentId,
      code: "123456",
    });
    expect(revalidatePath.mock.calls.map((call) => call[0])).toEqual([PAGE, USERS, ACTIVITY]);
  });

  it("maps a wrong code (409) to the locale sentence and still revalidates", async () => {
    api.confirmOwnTwoStep.mockResolvedValue({
      outcome: "conflict",
      message: "That code didn't work. Try again.",
    });
    expect(
      await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: "000000" }),
    ).toEqual({
      status: "error",
      reason: "wrong_code",
      message: en.accountSecurity.errors.wrongCode,
    });
    cookieLocale.value = "ar";
    expect(
      await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: "000000" }),
    ).toMatchObject({
      message: ar.accountSecurity.errors.wrongCode,
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it("a rate limit (429) says to wait; a missing enrolment (404) says the setup expired", async () => {
    api.confirmOwnTwoStep.mockResolvedValue({
      outcome: "error",
      message: "x",
      status: 429,
      code: "RATE_LIMITED",
    });
    expect(
      await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: "1" }),
    ).toMatchObject({
      reason: "limited",
      message: en.accountSecurity.errors.limited,
    });
    api.confirmOwnTwoStep.mockResolvedValue({ outcome: "not_found" });
    expect(
      await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: "1" }),
    ).toMatchObject({
      reason: "expired",
      message: en.accountSecurity.errors.expired,
    });
  });

  it("refuses an empty code or enrolment id without calling the API", async () => {
    expect(
      await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: "  " }),
    ).toMatchObject({
      reason: "validation",
      message: en.accountSecurity.errors.codeRequired,
    });
    expect(await confirmTwoStepAction({ enrollmentId: "", code: "123456" })).toMatchObject({
      reason: "validation",
    });
    expect(
      await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: "x".repeat(33) }),
    ).toMatchObject({
      reason: "validation",
    });
    expect(api.confirmOwnTwoStep).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized", { outcome: "unauthorized" }, "unauthorized", en.formErrors.unauthorized],
    ["forbidden", { outcome: "forbidden" }, "forbidden", en.formErrors.forbidden],
    [
      "invalid",
      { outcome: "invalid", message: "m", fields: [] },
      "validation",
      en.formErrors.invalid,
    ],
    [
      "error",
      { outcome: "error", message: "boom", status: 500 },
      "unexpected",
      en.formErrors.unexpected,
    ],
  ] as const)(
    "revalidates after %s and reports it in the locale",
    async (_name, result, reason, message) => {
      api.confirmOwnTwoStep.mockResolvedValue(result);
      expect(
        await confirmTwoStepAction({ enrollmentId: SETUP.enrollmentId, code: "123456" }),
      ).toEqual({
        status: "error",
        reason,
        message,
      });
      expect(revalidatePath).toHaveBeenCalledWith(PAGE);
      expect(revalidatePath).toHaveBeenCalledWith(USERS);
    },
  );
});

describe("regenerateBackupCodesAction", () => {
  it("returns the new codes once and revalidates every affected path", async () => {
    api.regenerateBackupCodes.mockResolvedValue({ outcome: "ok", data: { backupCodes: CODES } });
    expect(await regenerateBackupCodesAction({ code: "123456" })).toEqual({
      status: "ok",
      data: { backupCodes: CODES },
    });
    expect(api.regenerateBackupCodes).toHaveBeenCalledWith("123456");
    expect(revalidatePath.mock.calls.map((call) => call[0])).toEqual([PAGE, USERS, ACTIVITY]);
  });

  it('maps a wrong code and "isn\'t on", revalidating both times', async () => {
    api.regenerateBackupCodes.mockResolvedValue({
      outcome: "conflict",
      message: "That code didn't work. Try again.",
    });
    expect(await regenerateBackupCodesAction({ code: "1" })).toMatchObject({
      reason: "wrong_code",
    });
    api.regenerateBackupCodes.mockResolvedValue({
      outcome: "conflict",
      message: "Two-step verification isn't on",
    });
    expect(await regenerateBackupCodesAction({ code: "1" })).toMatchObject({
      reason: "not_on",
      message: en.accountSecurity.errors.notOn,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(6);
  });

  it("refuses an empty code without calling the API", async () => {
    expect(await regenerateBackupCodesAction({ code: "" })).toMatchObject({ reason: "validation" });
    expect(api.regenerateBackupCodes).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("disableTwoStepAction", () => {
  it("turns it off with the password and revalidates every affected path", async () => {
    api.disableOwnTwoStep.mockResolvedValue({ outcome: "ok", data: {} });
    expect(await disableTwoStepAction({ password: "correct horse" })).toEqual({
      status: "ok",
      data: null,
    });
    expect(api.disableOwnTwoStep).toHaveBeenCalledWith("correct horse");
    expect(revalidatePath.mock.calls.map((call) => call[0])).toEqual([PAGE, USERS, ACTIVITY]);
  });

  it("a 401 INVALID_PASSWORD is a wrong password; a plain 401 is a signed-out session", async () => {
    api.disableOwnTwoStep.mockResolvedValue({ outcome: "unauthorized", code: "INVALID_PASSWORD" });
    expect(await disableTwoStepAction({ password: "nope" })).toEqual({
      status: "error",
      reason: "wrong_password",
      message: en.accountSecurity.errors.wrongPassword,
    });
    api.disableOwnTwoStep.mockResolvedValue({ outcome: "unauthorized" });
    expect(await disableTwoStepAction({ password: "nope" })).toEqual({
      status: "error",
      reason: "unauthorized",
      message: en.formErrors.unauthorized,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(6);
  });

  it("the store policy refusal (409) is policy_required in the locale", async () => {
    api.disableOwnTwoStep.mockResolvedValue({
      outcome: "conflict",
      message: "Your store requires two-step verification, so it can't be turned off",
    });
    expect(await disableTwoStepAction({ password: "pw" })).toMatchObject({
      reason: "policy_required",
      message: en.accountSecurity.errors.policyRequired,
    });
    cookieLocale.value = "ar";
    expect(await disableTwoStepAction({ password: "pw" })).toMatchObject({
      message: ar.accountSecurity.errors.policyRequired,
    });
  });

  it("refuses an empty or oversized password without calling the API", async () => {
    expect(await disableTwoStepAction({ password: "" })).toMatchObject({
      reason: "validation",
      message: en.accountSecurity.errors.passwordRequired,
    });
    expect(await disableTwoStepAction({ password: "x".repeat(257) })).toMatchObject({
      reason: "validation",
    });
    expect(api.disableOwnTwoStep).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
