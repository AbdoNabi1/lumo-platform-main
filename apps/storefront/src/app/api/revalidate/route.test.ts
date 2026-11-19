// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag }));
const { POST } = await import("./route");

const SECRET = "r".repeat(40);
const post = (body: unknown, secret?: string) =>
  POST(
    new Request("https://shop.example/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret === undefined ? {} : { "x-revalidate-secret": secret }),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", SECRET));
afterEach(() => {
  vi.unstubAllEnvs();
  revalidateTag.mockReset();
});

describe("POST /api/revalidate", () => {
  it("revalidates exactly the shop's tag with the right secret", async () => {
    const res = await post({ shopId: "shop-a" }, SECRET);
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("os:shop-a");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("refuses a missing or wrong secret, and refuses everything when none is configured", async () => {
    expect((await post({ shopId: "shop-a" })).status).toBe(401);
    expect((await post({ shopId: "shop-a" }, `${SECRET}x`)).status).toBe(401);
    vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", "");
    expect((await post({ shopId: "shop-a" }, "")).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses everything when the configured secret is shorter than 32 bytes", async () => {
    vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", "short");
    expect((await post({ shopId: "shop-a" }, "short")).status).toBe(401);
    delete process.env["STOREFRONT_REVALIDATE_SECRET"];
    expect((await post({ shopId: "shop-a" }, "")).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("answers every refusal identically, with no detail about why", async () => {
    const missing = await post({ shopId: "shop-a" });
    const wrong = await post({ shopId: "shop-a" }, "w".repeat(40));
    const longer = await post({ shopId: "shop-a" }, SECRET.repeat(3));
    const texts = await Promise.all([missing, wrong, longer].map((r) => r.text()));
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).not.toMatch(/secret|missing|wrong|configured/i);
  });

  it("refuses a malformed shop id", async () => {
    for (const shopId of ["", "../x", "a b", 7, "x".repeat(65)]) {
      expect((await post({ shopId }, SECRET)).status).toBe(400);
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses an unreadable body after the secret check", async () => {
    const res = await POST(
      new Request("https://shop.example/api/revalidate", {
        method: "POST",
        headers: { "x-revalidate-secret": SECRET },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
