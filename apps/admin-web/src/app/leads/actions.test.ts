import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationResult } from "@/lib/api/client";
import type { FormState } from "@/lib/api/mutation";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  changeLeadStatus: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/api/leads", () => ({ changeLeadStatus: mocks.changeLeadStatus }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { changeLeadStatusAction } = await import("./actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
}

beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
});

function expectBothPathsRevalidated() {
  expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads/lead-1");
}

describe("changeLeadStatusAction", () => {
  it("calls the API once with one idempotency key and revalidates both paths on success", async () => {
    mocks.changeLeadStatus.mockResolvedValue({ outcome: "ok", data: {} });

    const state = await changeLeadStatusAction(
      idle,
      form({ leadId: "lead-1", status: "qualified" }),
    );

    expect(state).toEqual({ status: "success" });
    expect(mocks.changeLeadStatus).toHaveBeenCalledTimes(1);
    const [id, status, key] = mocks.changeLeadStatus.mock.calls[0] as [string, string, string];
    expect([id, status]).toEqual(["lead-1", "qualified"]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expectBothPathsRevalidated();
  });

  it("mints a different key for each submit", async () => {
    mocks.changeLeadStatus.mockResolvedValue({ outcome: "ok", data: {} });
    await changeLeadStatusAction(idle, form({ leadId: "lead-1", status: "new" }));
    await changeLeadStatusAction(idle, form({ leadId: "lead-1", status: "new" }));
    const keys = mocks.changeLeadStatus.mock.calls.map((call) => (call as string[])[2]);
    expect(new Set(keys).size).toBe(2);
  });

  const failures: readonly [string, MutationResult<unknown>][] = [
    ["409 conflict", { outcome: "conflict", message: "busy" }],
    ["422 invalid", { outcome: "invalid", message: "bad", fields: [] }],
    ["403 forbidden", { outcome: "forbidden" }],
    ["401 unauthorized", { outcome: "unauthorized" }],
    ["404 not found", { outcome: "not_found" }],
    ["network/unknown error", { outcome: "error", message: "down" }],
  ];

  it.each(failures)("revalidates /leads and /leads/{id} after a %s too", async (_name, result) => {
    mocks.changeLeadStatus.mockResolvedValue(result);

    const state = await changeLeadStatusAction(
      idle,
      form({ leadId: "lead-1", status: "rejected" }),
    );

    expect(state.status).toBe("error");
    expectBothPathsRevalidated();
  });

  it("maps a failure through toFormState (409 keeps the API's message, 403 is the forbidden copy)", async () => {
    mocks.changeLeadStatus.mockResolvedValueOnce({ outcome: "conflict", message: "busy" });
    expect(await changeLeadStatusAction(idle, form({ leadId: "lead-1", status: "new" }))).toEqual({
      status: "error",
      message: "busy",
      fieldErrors: {},
    });
    mocks.changeLeadStatus.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await changeLeadStatusAction(idle, form({ leadId: "lead-1", status: "new" }))).toEqual({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
  });

  it("still revalidates when the call throws, and rethrows", async () => {
    mocks.changeLeadStatus.mockRejectedValue(new Error("boom"));

    await expect(
      changeLeadStatusAction(idle, form({ leadId: "lead-1", status: "new" })),
    ).rejects.toThrow("boom");
    expectBothPathsRevalidated();
  });

  it("rejects a missing id locally: no API call, nothing revalidated", async () => {
    const state = await changeLeadStatusAction(idle, form({ status: "new" }));

    expect(state).toEqual({ status: "error", message: en.formErrors.invalid, fieldErrors: {} });
    expect(mocks.changeLeadStatus).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an unknown status locally: no API call, nothing revalidated", async () => {
    const state = await changeLeadStatusAction(idle, form({ leadId: "lead-1", status: "won" }));

    expect(state.status).toBe("error");
    expect(mocks.changeLeadStatus).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
