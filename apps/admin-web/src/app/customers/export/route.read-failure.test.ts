import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The real customer client and shared GET helper run here; only the network and the cookie store
// are faked, so an unreadable 200 body travels the same path it would in production.
const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const { GET } = await import("./route");

const request = () =>
  new NextRequest("http://localhost:3001/customers/export?scope=all", {
    headers: { host: "localhost:3001" },
  });

const exportRow = {
  id: "c-1",
  name: "Nour Hassan",
  email: "nour@example.com",
  phone: null,
  language: null,
  emailMarketing: false,
  smsMarketing: true,
  tags: ["VIP"],
  note: null,
  isGuest: false,
  address: { line1: "1 Nile St", city: "Cairo", postalCode: "11511", country: "EG" },
};
const validPage = () =>
  new Response(
    JSON.stringify({ items: [exportRow], pageInfo: { hasNextPage: true, endCursor: "c-1" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
const truncated = () =>
  new Response("{", { status: 200, headers: { "content-type": "application/json" } });
const unreadable = () => {
  const response = new Response("{}", { status: 200 });
  vi.spyOn(response, "json").mockRejectedValue(new TypeError("terminated"));
  return response;
};

async function expectFailedRedirect(response: Response): Promise<void> {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "http://localhost:3001/customers?exportError=failed",
  );
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(response.headers.get("content-type") ?? "").not.toContain("text/csv");
}

describe("GET /customers/export — unreadable page bodies (real customer client)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    cookiesMock.mockResolvedValue({ get: () => undefined });
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("a 200 with a truncated JSON body on page 1 redirects with exportError=failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(truncated());
    vi.stubGlobal("fetch", fetchMock);

    await expectFailedRedirect(await GET(request()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the same failure after one valid page never yields a partial CSV", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(validPage()).mockResolvedValueOnce(truncated());
    vi.stubGlobal("fetch", fetchMock);

    await expectFailedRedirect(await GET(request()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a body read that rejects redirects with exportError=failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(unreadable());
    vi.stubGlobal("fetch", fetchMock);

    await expectFailedRedirect(await GET(request()));
  });
});
