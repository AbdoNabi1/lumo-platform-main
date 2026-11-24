// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  createCustomerSegment: vi.fn(),
  updateCustomerSegment: vi.fn(),
  deleteCustomerSegment: vi.fn(),
  previewCustomerSegment: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
);
const cookieLocale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/customer-segments", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieLocale.value === undefined ? undefined : { value: cookieLocale.value }),
  }),
}));

const { createSegmentAction, deleteSegmentAction, previewSegmentAction, updateSegmentAction } =
  await import("./actions");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "7c1f0f6e-0000-4000-8000-000000000001";
const CONDITIONS = [{ field: "orders_count", op: "gte", value: 3 }] as const;

const failures = [
  ["unauthorized", { outcome: "unauthorized" }, en.formErrors.unauthorized],
  ["forbidden", { outcome: "forbidden" }, en.formErrors.forbidden],
  ["not_found", { outcome: "not_found" }, en.formErrors.notFound],
  ["error", { outcome: "error", message: "boom" }, en.formErrors.unexpected],
] as const;

beforeEach(() => {
  expect.hasAssertions();
  cookieLocale.value = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createSegmentAction", () => {
  it("sends the name and conditions with a fresh key, revalidates list + detail, then redirects to the segment", async () => {
    api.createCustomerSegment.mockResolvedValue({ outcome: "ok", data: { segmentId: ID } });

    await expect(createSegmentAction({ name: "VIP", conditions: CONDITIONS })).rejects.toThrow(
      `NEXT_REDIRECT:/customers/segments/${ID}`,
    );

    const [body, key] = api.createCustomerSegment.mock.calls[0] as [unknown, string];
    expect(body).toEqual({ name: "VIP", conditions: CONDITIONS });
    expect(key).toMatch(UUID);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/customers/segments",
      `/customers/segments/${ID}`,
    ]);
    expect(redirect).toHaveBeenCalledWith(`/customers/segments/${ID}`);
  });

  it("uses a new key per invocation", async () => {
    api.createCustomerSegment.mockResolvedValue({ outcome: "error", message: "x" });

    await createSegmentAction({ name: "A", conditions: CONDITIONS });
    await createSegmentAction({ name: "A", conditions: CONDITIONS });

    const keys = api.createCustomerSegment.mock.calls.map((call) => call[1] as string);
    expect(new Set(keys).size).toBe(2);
  });

  it("a failure revalidates the list only and does not redirect", async () => {
    api.createCustomerSegment.mockResolvedValue({ outcome: "forbidden" });

    const state = await createSegmentAction({ name: "VIP", conditions: CONDITIONS });

    expect(state).toEqual({ status: "error", message: en.formErrors.forbidden, fieldErrors: {} });
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/customers/segments"]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("409 'A segment with this name already exists' -> the duplicate-name message under Name", async () => {
    api.createCustomerSegment.mockResolvedValue({
      outcome: "conflict",
      message: "A segment with this name already exists",
      code: "CONFLICT",
    });

    const state = await createSegmentAction({ name: "VIP", conditions: CONDITIONS });

    expect(state).toEqual({
      status: "error",
      message: en.segments.errors.duplicateName,
      fieldErrors: { name: en.segments.errors.duplicateName },
    });
  });

  it("any other 409 (the 100-segment limit, an in-flight key) -> the generic conflict copy", async () => {
    api.createCustomerSegment.mockResolvedValue({
      outcome: "conflict",
      message: "A store can have at most 100 segments",
    });

    expect(await createSegmentAction({ name: "VIP", conditions: CONDITIONS })).toEqual({
      status: "error",
      message: en.formErrors.conflict,
      fieldErrors: {},
    });
  });

  it("422 keeps the server field paths (name, conditions.0.value)", async () => {
    api.createCustomerSegment.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid segment",
      fields: [
        { field: "name", message: "Enter a name" },
        { field: "conditions.0.value", message: "Enter a whole number" },
      ],
    });

    const state = await createSegmentAction({ name: "", conditions: CONDITIONS });

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { name: "Enter a name", "conditions.0.value": "Enter a whole number" },
    });
  });

  it.each(failures)("%s -> the locale's generic message", async (_name, result, message) => {
    api.createCustomerSegment.mockResolvedValue(result);

    expect(await createSegmentAction({ name: "VIP", conditions: CONDITIONS })).toEqual({
      status: "error",
      message,
      fieldErrors: {},
    });
  });

  it("speaks the Arabic locale from the cookie", async () => {
    cookieLocale.value = "ar";
    api.createCustomerSegment.mockResolvedValue({
      outcome: "conflict",
      message: "A segment with this name already exists",
    });

    const state = await createSegmentAction({ name: "VIP", conditions: CONDITIONS });

    expect(state).toMatchObject({ message: ar.segments.errors.duplicateName });
  });
});

describe("updateSegmentAction", () => {
  const input = { expectedVersion: 2, name: "VIP 2", conditions: CONDITIONS };

  it("sends expectedVersion, name and conditions with a fresh key; revalidates list + detail on success", async () => {
    api.updateCustomerSegment.mockResolvedValue({
      outcome: "ok",
      data: { segmentId: ID, version: 3 },
    });

    expect(await updateSegmentAction(ID, input)).toEqual({ status: "success" });

    const [id, body, key] = api.updateCustomerSegment.mock.calls[0] as [string, unknown, string];
    expect(id).toBe(ID);
    expect(body).toEqual({ expectedVersion: 2, name: "VIP 2", conditions: CONDITIONS });
    expect(key).toMatch(UUID);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/customers/segments",
      `/customers/segments/${ID}`,
    ]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("409 'This segment was changed by someone else' -> the stale message; still revalidates both paths", async () => {
    api.updateCustomerSegment.mockResolvedValue({
      outcome: "conflict",
      message: "This segment was changed by someone else",
      code: "CONFLICT",
    });

    expect(await updateSegmentAction(ID, input)).toEqual({
      status: "error",
      message: en.segments.errors.stale,
      fieldErrors: {},
    });
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/customers/segments",
      `/customers/segments/${ID}`,
    ]);
  });

  it("409 'Default segments can't be changed' -> the read-only message", async () => {
    api.updateCustomerSegment.mockResolvedValue({
      outcome: "conflict",
      message: "Default segments can't be changed",
    });

    expect(await updateSegmentAction("default:not_purchased", input)).toEqual({
      status: "error",
      message: en.segments.errors.readOnly,
      fieldErrors: {},
    });
  });

  it("409 duplicate name -> under Name; other 409 -> generic", async () => {
    api.updateCustomerSegment.mockResolvedValueOnce({
      outcome: "conflict",
      message: "A segment with this name already exists",
    });
    expect(await updateSegmentAction(ID, input)).toMatchObject({
      fieldErrors: { name: en.segments.errors.duplicateName },
    });

    api.updateCustomerSegment.mockResolvedValueOnce({ outcome: "conflict", message: "Other" });
    expect(await updateSegmentAction(ID, input)).toMatchObject({
      message: en.formErrors.conflict,
      fieldErrors: {},
    });
  });

  it("422 keeps the server field paths", async () => {
    api.updateCustomerSegment.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid segment",
      fields: [{ field: "conditions.1.days", message: "Use 1 to 3650 days" }],
    });

    expect(await updateSegmentAction(ID, input)).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "conditions.1.days": "Use 1 to 3650 days" },
    });
  });

  it.each(failures)(
    "%s -> the generic message, and still revalidates",
    async (_n, result, message) => {
      api.updateCustomerSegment.mockResolvedValue(result);

      expect(await updateSegmentAction(ID, input)).toEqual({
        status: "error",
        message,
        fieldErrors: {},
      });
      expect(revalidatePath).toHaveBeenCalledTimes(2);
    },
  );

  it("refuses an empty id or a bad version without calling the API or revalidating", async () => {
    expect(await updateSegmentAction("", input)).toMatchObject({ status: "error" });
    expect(await updateSegmentAction(ID, { ...input, expectedVersion: 0 })).toMatchObject({
      status: "error",
    });
    expect(api.updateCustomerSegment).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteSegmentAction", () => {
  it("sends expectedVersion with a fresh key, revalidates list + detail, redirects to the list", async () => {
    api.deleteCustomerSegment.mockResolvedValue({ outcome: "ok", data: { segmentId: ID } });

    await expect(deleteSegmentAction(ID, 4)).rejects.toThrow("NEXT_REDIRECT:/customers/segments");

    const [id, version, key] = api.deleteCustomerSegment.mock.calls[0] as [string, number, string];
    expect([id, version]).toEqual([ID, 4]);
    expect(key).toMatch(UUID);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/customers/segments",
      `/customers/segments/${ID}`,
    ]);
  });

  it("a stale 409 shows the stale message, revalidates both paths and stays", async () => {
    api.deleteCustomerSegment.mockResolvedValue({
      outcome: "conflict",
      message: "This segment was changed by someone else",
    });

    expect(await deleteSegmentAction(ID, 4)).toEqual({
      status: "error",
      message: en.segments.errors.stale,
      fieldErrors: {},
    });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("default -> read-only message; 404 -> not found; 403 -> forbidden", async () => {
    api.deleteCustomerSegment.mockResolvedValueOnce({
      outcome: "conflict",
      message: "Default segments can't be changed",
    });
    expect(await deleteSegmentAction("default:not_purchased", 1)).toMatchObject({
      message: en.segments.errors.readOnly,
    });
    api.deleteCustomerSegment.mockResolvedValueOnce({ outcome: "not_found" });
    expect(await deleteSegmentAction(ID, 1)).toMatchObject({ message: en.formErrors.notFound });
    api.deleteCustomerSegment.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await deleteSegmentAction(ID, 1)).toMatchObject({ message: en.formErrors.forbidden });
  });

  it("refuses an empty id or a bad version without calling the API", async () => {
    expect(await deleteSegmentAction("", 1)).toMatchObject({ status: "error" });
    expect(await deleteSegmentAction(ID, 1.5)).toMatchObject({ status: "error" });
    expect(api.deleteCustomerSegment).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("previewSegmentAction", () => {
  const page = {
    items: [],
    pageInfo: { hasNextPage: false, endCursor: null },
    total: 0,
    currency: "EGP",
  };

  it("asks for the first 10, with no key and no revalidation, and returns the page", async () => {
    api.previewCustomerSegment.mockResolvedValue({ outcome: "ok", data: page });

    expect(await previewSegmentAction(CONDITIONS)).toEqual({ status: "ok", page });

    expect(api.previewCustomerSegment).toHaveBeenCalledWith(CONDITIONS, 10);
    expect(api.previewCustomerSegment.mock.calls[0]).toHaveLength(2);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("503 UNAVAILABLE -> unavailable; a 503 without the code is a plain error", async () => {
    api.previewCustomerSegment.mockResolvedValueOnce({
      outcome: "error",
      message: "x",
      status: 503,
      code: "UNAVAILABLE",
    });
    expect(await previewSegmentAction(CONDITIONS)).toEqual({ status: "unavailable" });

    api.previewCustomerSegment.mockResolvedValueOnce({
      outcome: "error",
      message: "x",
      status: 503,
    });
    expect(await previewSegmentAction(CONDITIONS)).toEqual({
      status: "error",
      message: en.formErrors.unexpected,
      fieldErrors: {},
    });
  });

  it("422 returns the server field paths for the rows", async () => {
    api.previewCustomerSegment.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid segment",
      fields: [{ field: "conditions.0.value", message: "Enter a whole number" }],
    });

    expect(await previewSegmentAction(CONDITIONS)).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "conditions.0.value": "Enter a whole number" },
    });
  });
});
