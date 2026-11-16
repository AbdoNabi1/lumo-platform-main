import { beforeEach, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import type { FormState } from "@/lib/api/mutation";

const api = vi.hoisted(() => ({ updateCarrier: vi.fn(), rotateCarrierWebhookSecret: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/carriers", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: "ar" }) }),
}));
import {
  saveCarrierAction,
  disconnectCarrierAction,
  rotateCarrierSecretAction,
} from "./carrier-actions";

const idle: FormState = { status: "idle" };
function form(changes: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    carrierKey: "bosta",
    apiKey: "",
    awbFormat: "A6",
    awbLanguage: "ar",
    ...changes,
  }))
    data.set(key, value);
  return data;
}
beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
  api.updateCarrier.mockResolvedValue({ outcome: "ok", data: {} });
  api.rotateCarrierWebhookSecret.mockResolvedValue({ outcome: "ok", data: {} });
});
it("does not send credentials when the API key is empty", async () => {
  expect(await saveCarrierAction(idle, form())).toEqual({ status: "success" });
  expect(api.updateCarrier).toHaveBeenCalledWith(
    "bosta",
    { enabled: false, config: { awbFormat: "A6", awbLanguage: "ar", allowToOpenPackage: false } },
    expect.any(String),
  );
  expect(revalidatePath).toHaveBeenCalledWith("/settings/shipping");
});
it("rejects invalid format before calling the API", async () => {
  expect(await saveCarrierAction(idle, form({ awbFormat: "Z" }))).toEqual({
    status: "error",
    message: ar.formErrors.invalid,
    fieldErrors: {},
  });
  expect(api.updateCarrier).not.toHaveBeenCalled();
});
it("localizes a rejected key", async () => {
  api.updateCarrier.mockResolvedValue({
    outcome: "conflict",
    code: "CARRIER_CREDENTIALS_REJECTED",
  });
  expect(await saveCarrierAction(idle, form())).toEqual({
    status: "error",
    message: ar.carrierSettings.credentialsRejected,
    fieldErrors: {},
  });
});
it("returns a localized fallback for thrown errors", async () => {
  api.updateCarrier.mockRejectedValue(new Error("x"));
  expect(await saveCarrierAction(idle, form())).toEqual({
    status: "error",
    message: ar.formErrors.unexpected,
    fieldErrors: {},
  });
});
it("rethrows Next redirect errors", async () => {
  const { getRedirectError } = await import("next/dist/client/components/redirect");
  const { RedirectType } = await import("next/dist/client/components/redirect-error");
  const redirect = getRedirectError("/login", RedirectType.push);
  api.updateCarrier.mockRejectedValue(redirect);
  await expect(saveCarrierAction(idle, form())).rejects.toBe(redirect);
});
it("validates keys for disconnect and rotation", async () => {
  expect(await disconnectCarrierAction("Bad Key")).toEqual({
    status: "error",
    message: ar.formErrors.invalid,
    fieldErrors: {},
  });
  expect(await rotateCarrierSecretAction("Bad Key")).toEqual({
    status: "error",
    message: ar.formErrors.invalid,
    fieldErrors: {},
  });
  expect(api.updateCarrier).not.toHaveBeenCalled();
  expect(api.rotateCarrierWebhookSecret).not.toHaveBeenCalled();
});
