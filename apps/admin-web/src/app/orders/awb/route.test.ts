import { beforeEach, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";

const api = vi.hoisted(() => ({ fetchAwbPdf: vi.fn() }));
vi.mock("@/lib/api/carrier-shipments", () => api);
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: "ar" }) }),
}));

const { GET } = await import("./route");

function request(query: string): Parameters<typeof GET>[0] {
  return new Request(`http://localhost/orders/awb${query}`) as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
});

it("streams application/pdf with private, no-store and never caches", async () => {
  api.fetchAwbPdf.mockResolvedValue({ outcome: "ok", bytes: new Uint8Array([37, 80, 68, 70]) });
  const response = await GET(request("?orderIds=a,b&format=A4&lang=en"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  expect(api.fetchAwbPdf).toHaveBeenCalledWith({
    orderIds: ["a", "b"],
    format: "A4",
    lang: "en",
  });
});

it("409 lists the order numbers in Arabic", async () => {
  api.fetchAwbPdf.mockResolvedValue({
    outcome: "conflict",
    code: "AWB_NOT_AVAILABLE",
    orderNumbers: ["1001", "1002"],
  });
  const response = await GET(request("?orderIds=a,b"));
  expect(response.status).toBe(409);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe("الطلبات دي لسه مالهاش بوليصة: #1001، #1002");
});

it("a conflict without order numbers uses the generic message", async () => {
  api.fetchAwbPdf.mockResolvedValue({ outcome: "conflict", orderNumbers: [] });
  const response = await GET(request("?orderIds=a"));
  expect(await response.text()).toBe(ar.carrierShipping.errors.AWB_NOT_AVAILABLE);
});

it("a bad orderIds list is 400 with no API call", async () => {
  const many = Array.from({ length: 51 }, (_, i) => `o${i}`).join(",");
  for (const query of [
    "?orderIds=",
    "",
    `?orderIds=${many}`,
    "?orderIds=../x",
    "?orderIds=a&format=A3",
  ]) {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(ar.formErrors.invalid);
  }
  expect(api.fetchAwbPdf).not.toHaveBeenCalled();
});

it("maps the other outcomes to statuses without caching", async () => {
  const cases: readonly [unknown, number][] = [
    [{ outcome: "unauthorized" }, 401],
    [{ outcome: "not_found" }, 404],
    [{ outcome: "error", message: "x" }, 502],
  ];
  for (const [result, status] of cases) {
    api.fetchAwbPdf.mockResolvedValue(result);
    const response = await GET(request("?orderIds=a"));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});
