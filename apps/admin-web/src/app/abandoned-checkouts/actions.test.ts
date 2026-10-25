import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({ issueRecoveryLink: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/abandoned-checkouts", () => ({ issueRecoveryLink: api.issueRecoveryLink }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { issueRecoveryLinkAction } = await import("./actions");

const ID = "01920000-0000-7000-8000-00000000abcd";
const r = en.abandonedCheckouts.recovery;
const link = (url: string | null) => ({
  outcome: "ok",
  data: { url, path: "/c/tok", expiresAt: "2026-10-25T12:00:00.000Z", shopName: "Sara Shop" },
});

beforeEach(() => {
  vi.stubEnv("STOREFRONT_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("issueRecoveryLinkAction (order operations Part 3)", () => {
  it("answers the API's URL and the shop name, and refreshes the pages", async () => {
    api.issueRecoveryLink.mockResolvedValue(link("https://www.sara.shop/c/tok"));
    expect(await issueRecoveryLinkAction(ID)).toEqual({
      ok: true,
      url: "https://www.sara.shop/c/tok",
      shopName: "Sara Shop",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/abandoned-checkouts/${ID}`);
  });

  it("falls back to STOREFRONT_URL + path when the shop has no domain", async () => {
    vi.stubEnv("STOREFRONT_URL", "https://shop.example/");
    api.issueRecoveryLink.mockResolvedValue(link(null));
    expect(await issueRecoveryLinkAction(ID)).toMatchObject({
      ok: true,
      url: "https://shop.example/c/tok",
    });
  });

  it("says so when there is no address at all", async () => {
    api.issueRecoveryLink.mockResolvedValue(link(null));
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.noStoreAddress });
  });

  it("one fresh idempotency key per press", async () => {
    api.issueRecoveryLink.mockResolvedValue(link("https://x.shop/c/tok"));
    await issueRecoveryLinkAction(ID);
    await issueRecoveryLinkAction(ID);
    const keys = api.issueRecoveryLink.mock.calls.map((call) => call[1] as string);
    expect(keys[0]).not.toBe(keys[1]);
    expect(api.issueRecoveryLink.mock.calls[0]?.[0]).toBe(ID);
  });

  it("maps refusals to the merchant's words", async () => {
    api.issueRecoveryLink.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.forbidden });
    api.issueRecoveryLink.mockResolvedValueOnce({ outcome: "unauthorized" });
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.sessionExpired });
    api.issueRecoveryLink.mockResolvedValueOnce({
      outcome: "conflict",
      message: "ALREADY_RECOVERED: x",
    });
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.alreadyRecovered });
    api.issueRecoveryLink.mockResolvedValueOnce({ outcome: "error", message: "boom" });
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.error });
  });

  it("refuses a malformed id without calling the API (the browser can send anything)", async () => {
    expect(await issueRecoveryLinkAction("../../orders")).toEqual({ ok: false, message: r.error });
    expect(api.issueRecoveryLink).not.toHaveBeenCalled();
  });
});
