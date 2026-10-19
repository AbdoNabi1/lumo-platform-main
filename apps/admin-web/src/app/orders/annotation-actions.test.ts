import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const orders = vi.hoisted(() => ({
  updateOrderNote: vi.fn(),
  changeOrderTags: vi.fn(),
  fetchOrderTagSuggestions: vi.fn(),
  addOrderComment: vi.fn(),
  editOrderComment: vi.fn(),
  deleteOrderComment: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/orders", () => orders);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { changeOrderTagsAction, saveOrderNoteAction, suggestOrderTagsAction } =
  await import("./annotation-actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
}

beforeEach(() => {
  for (const mock of Object.values(orders)) mock.mockReset();
  revalidatePath.mockReset();
});

describe("saveOrderNoteAction", () => {
  it("saves the trimmed note with a fresh key and refreshes the order page", async () => {
    orders.updateOrderNote.mockResolvedValue({ outcome: "ok", data: { note: "Ring twice" } });
    const state = await saveOrderNoteAction(idle, form({ orderId: "o-1", note: "  Ring twice " }));
    expect(state).toEqual({ status: "success" });
    expect(orders.updateOrderNote).toHaveBeenCalledWith("o-1", "Ring twice", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/orders/o-1");
  });

  it("sends null for a blank note (removes it)", async () => {
    orders.updateOrderNote.mockResolvedValue({ outcome: "ok", data: { note: null } });
    await saveOrderNoteAction(idle, form({ orderId: "o-1", note: "  \n " }));
    expect(orders.updateOrderNote).toHaveBeenCalledWith("o-1", null, expect.any(String));
  });

  it("refuses 5,001 characters without calling the API", async () => {
    const state = await saveOrderNoteAction(idle, form({ orderId: "o-1", note: "a".repeat(5001) }));
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["note"]).toBeDefined();
    expect(orders.updateOrderNote).not.toHaveBeenCalled();
  });
});

describe("changeOrderTagsAction", () => {
  it("adds and answers the order's tags", async () => {
    orders.changeOrderTags.mockResolvedValue({ outcome: "ok", data: { tags: ["VIP"] } });
    expect(await changeOrderTagsAction("o-1", { add: ["VIP"] })).toEqual({
      status: "saved",
      tags: ["VIP"],
    });
    expect(orders.changeOrderTags).toHaveBeenCalledWith(
      "o-1",
      { add: ["VIP"] },
      expect.any(String),
    );
  });

  it("refuses an empty change or a bad order id without calling the API", async () => {
    expect((await changeOrderTagsAction("o-1", {})).status).toBe("error");
    expect((await changeOrderTagsAction("", { add: ["x"] })).status).toBe("error");
    expect(orders.changeOrderTags).not.toHaveBeenCalled();
  });

  it("explains the 250-tag cap in the merchant's words instead of a bare 'check the fields'", async () => {
    orders.changeOrderTags.mockResolvedValue({
      outcome: "invalid",
      fields: [{ field: "tags", message: "an order can carry at most 250 tags" }],
    });
    expect(await changeOrderTagsAction("o-1", { add: ["x"] })).toEqual({
      status: "error",
      message: "An order can have up to 250 tags.",
    });
  });

  it("answers the API's refusal as a message", async () => {
    orders.changeOrderTags.mockResolvedValue({ outcome: "forbidden" });
    const state = await changeOrderTagsAction("o-1", { remove: ["VIP"] });
    expect(state).toEqual({ status: "error", message: expect.any(String) });
  });
});

describe("suggestOrderTagsAction", () => {
  it("answers the suggested spellings, and nothing for a blank prefix or a failed read", async () => {
    orders.fetchOrderTagSuggestions.mockResolvedValueOnce([{ tag: "VIP", count: 2 }]);
    expect(await suggestOrderTagsAction(" v ")).toEqual(["VIP"]);
    expect(orders.fetchOrderTagSuggestions).toHaveBeenCalledWith("v");
    expect(await suggestOrderTagsAction("  ")).toEqual([]);
    orders.fetchOrderTagSuggestions.mockResolvedValueOnce(null);
    expect(await suggestOrderTagsAction("v")).toEqual([]);
  });
});
