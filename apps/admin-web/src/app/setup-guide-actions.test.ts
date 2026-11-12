import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const api = vi.hoisted(() => ({ dismissSetupGuide: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());
const cookieValue = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock("@/lib/api/store-settings", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (cookieValue.locale === undefined ? undefined : { value: cookieValue.locale }),
    }),
}));

const { dismissSetupGuideAction } = await import("./setup-guide-actions");
const { en } = await import("@/messages/en");
const { ar } = await import("@/messages/ar");

const idle: FormState = { status: "idle" };

beforeEach(() => {
  cookieValue.locale = undefined;
  api.dismissSetupGuide.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidatePath.mockReset();
});

describe("dismissSetupGuideAction", () => {
  it("dismisses with one idempotency key and refreshes Home", async () => {
    const state = await dismissSetupGuideAction(idle, new FormData());

    expect(state).toEqual({ status: "success" });
    expect(api.dismissSetupGuide).toHaveBeenCalledTimes(1);
    expect(api.dismissSetupGuide).toHaveBeenCalledWith(expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("mints a fresh key for every submit", async () => {
    await dismissSetupGuideAction(idle, new FormData());
    await dismissSetupGuideAction(idle, new FormData());

    const [first, second] = api.dismissSetupGuide.mock.calls.map((call) => call[0] as string);
    expect(first).not.toBe(second);
  });

  it("projects a failure into an error state and leaves Home alone", async () => {
    api.dismissSetupGuide.mockResolvedValue({ outcome: "error", message: "boom" });

    const state = await dismissSetupGuideAction(idle, new FormData());

    expect(state).toMatchObject({ status: "error", message: en.formErrors.unexpected });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers in Arabic when the locale cookie says so", async () => {
    cookieValue.locale = "ar";
    api.dismissSetupGuide.mockResolvedValue({ outcome: "unauthorized" });

    const state = await dismissSetupGuideAction(idle, new FormData());

    expect(state).toMatchObject({ status: "error", message: ar.formErrors.unauthorized });
  });
});
