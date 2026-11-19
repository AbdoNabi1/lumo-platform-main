import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({ updatePreferences: vi.fn(), updateAccess: vi.fn() }));
const revalidate = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/online-store", () => api);
vi.mock("@/lib/storefront-revalidate", () => ({
  revalidateStorefront: revalidate.revalidateStorefront,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
const { saveAccessAction, savePreferencesAction } = await import("./actions");

const idle: FormState = { status: "idle" };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const p = en.onlineStorePreferences;

beforeEach(() => {
  api.updatePreferences.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  api.updateAccess.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidate.revalidateStorefront.mockReset().mockResolvedValue(true);
  revalidate.revalidatePath.mockReset();
});

describe("preferences actions", () => {
  it("sends both locales, the share image and the version with one key, then revalidates the storefront", async () => {
    const state = await savePreferencesAction(
      idle,
      form({
        "homeTitle.ar": "متجر",
        "homeTitle.en": "",
        "homeMetaDescription.ar": "",
        "homeMetaDescription.en": "Lamps",
        shareImageId: "img-1",
        defaultLocale: "en",
        expectedVersion: "3",
      }),
    );
    expect(state).toEqual({ status: "success" });
    expect(api.updatePreferences).toHaveBeenCalledWith(
      {
        homeTitle: { ar: "متجر", en: "" },
        homeMetaDescription: { ar: "", en: "Lamps" },
        shareImageId: "img-1",
        defaultLocale: "en",
        expectedVersion: 3,
      },
      expect.any(String),
    );
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/online-store/preferences");
  });

  it("sends no share image when the hidden field is empty", async () => {
    await savePreferencesAction(idle, form({ shareImageId: "", expectedVersion: "0" }));
    expect(api.updatePreferences.mock.calls[0]?.[0]).toMatchObject({
      shareImageId: null,
      defaultLocale: "ar",
    });
  });

  it("still succeeds when the storefront could not be told, with a soft 'up to a minute' note", async () => {
    revalidate.revalidateStorefront.mockResolvedValue(false);
    const state = await savePreferencesAction(idle, form({ expectedVersion: "1" }));
    expect(state).toEqual({ status: "success", liveDelayed: true });
  });

  it("does not revalidate after a failure, and explains a version conflict", async () => {
    api.updatePreferences.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: changed",
    });
    const state = await savePreferencesAction(
      idle,
      form({ defaultLocale: "ar", expectedVersion: "0" }),
    );
    expect(state).toMatchObject({
      status: "error",
      message: "This was changed in another window. Reload to continue.",
    });
    expect(revalidate.revalidateStorefront).not.toHaveBeenCalled();
  });

  it("a duplicate in-flight key (409 CONFLICT) is not a version conflict, and no server text shows", async () => {
    api.updatePreferences.mockResolvedValue({
      outcome: "conflict",
      message: "A request with this Idempotency-Key is already in flight",
    });
    const state = await savePreferencesAction(idle, form({ expectedVersion: "0" }));
    expect(state).toEqual({ status: "error", message: p.inFlight, fieldErrors: {} });
  });

  it("maps field codes to the merchant's language: too long, and an image that is gone", async () => {
    api.updatePreferences.mockResolvedValue({
      outcome: "invalid",
      message: "INVALID_CONTENT: Check the highlighted fields.",
      fields: [
        { field: "homeTitle.en", message: "TOO_LONG" },
        { field: "homeMetaDescription.ar", message: "INVALID_VALUE" },
      ],
    });
    expect(await savePreferencesAction(idle, form({ expectedVersion: "0" }))).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "homeTitle.en": p.tooLong, "homeMetaDescription.ar": en.formErrors.invalid },
    });

    api.updatePreferences.mockResolvedValue({
      outcome: "invalid",
      message: "IMAGE_NOT_FOUND: The image does not exist in this store.",
      fields: [{ field: "shareImageId", message: "IMAGE_NOT_FOUND" }],
    });
    expect(await savePreferencesAction(idle, form({ expectedVersion: "0" }))).toEqual({
      status: "error",
      message: p.imageNotFound,
      fieldErrors: { shareImageId: p.imageNotFound },
    });
  });

  it("access: an empty password field means keep (null), and the lock switch is a checkbox", async () => {
    await saveAccessAction(
      idle,
      form({
        locked: "on",
        password: "",
        "message.ar": "قريبًا",
        "message.en": "",
        expectedVersion: "1",
      }),
    );
    expect(api.updateAccess).toHaveBeenCalledWith(
      { locked: true, password: null, message: { ar: "قريبًا", en: "" }, expectedVersion: 1 },
      expect.any(String),
    );
    await saveAccessAction(idle, form({ password: "1234", expectedVersion: "2" }));
    expect(api.updateAccess).toHaveBeenLastCalledWith(
      { locked: false, password: "1234", message: { ar: "", en: "" }, expectedVersion: 2 },
      expect.any(String),
    );
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(2);
  });

  it("access: PASSWORD_REQUIRED becomes a field message", async () => {
    api.updateAccess.mockResolvedValue({
      outcome: "invalid",
      message: "PASSWORD_REQUIRED: Set a password",
      fields: [{ field: "password", message: "PASSWORD_REQUIRED" }],
    });
    const state = await saveAccessAction(idle, form({ locked: "on", expectedVersion: "0" }));
    expect(state).toEqual({
      status: "error",
      message: "Set a password before locking the store.",
      fieldErrors: { password: "Set a password before locking the store." },
    });
  });

  it("access: PASSWORD_LENGTH, a version conflict and a refused (non-admin) save use our own copy", async () => {
    api.updateAccess.mockResolvedValue({
      outcome: "invalid",
      message: "PASSWORD_LENGTH: Use 4 to 100 characters.",
      fields: [{ field: "password", message: "PASSWORD_LENGTH" }],
    });
    expect(await saveAccessAction(idle, form({ password: "12", expectedVersion: "0" }))).toEqual({
      status: "error",
      message: p.passwordLength,
      fieldErrors: { password: p.passwordLength },
    });
    api.updateAccess.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: This was changed in another window. Reload to continue.",
    });
    expect(await saveAccessAction(idle, form({ expectedVersion: "0" }))).toEqual({
      status: "error",
      message: p.conflict,
      fieldErrors: {},
    });
    api.updateAccess.mockResolvedValue({ outcome: "forbidden" });
    expect(await saveAccessAction(idle, form({ expectedVersion: "0" }))).toEqual({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    expect(revalidate.revalidateStorefront).not.toHaveBeenCalled();
  });
});
