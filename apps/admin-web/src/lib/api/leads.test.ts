import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  expect.hasAssertions();
});

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const { fetchLead, fetchLeadExportRows, fetchLeadsPage, changeLeadStatus } =
  await import("./leads");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LEAD = {
  id: "lead-1",
  formId: "form-1",
  name: "منى",
  phone: "+201001234567",
  phoneE164: "+201001234567",
  email: null,
  message: "عايزة أعرف السعر",
  status: "new",
  trackingStatus: "pending",
  eventId: "lead_lead-1",
  createdAt: "2026-11-22T10:00:00.000Z",
  pageUrl: "https://shop.example.com/",
  referrer: null,
};
const EMPTY_PAGE = { items: [], pageInfo: { hasNextPage: false, endCursor: null } };

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchLeadsPage", () => {
  it("maps ok to items and pageInfo", async () => {
    const page = { items: [LEAD], pageInfo: { hasNextPage: true, endCursor: "c1" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, page)));

    const result = await fetchLeadsPage({ first: 20 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
  });

  it("sends first, after, status and search on GET /api/v1/leads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, EMPTY_PAGE));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLeadsPage({ first: 20, after: "cur-1", status: "qualified", search: "منى 0100" });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("http://runtime.test/api/v1/leads");
    expect(parsed.searchParams.get("first")).toBe("20");
    expect(parsed.searchParams.get("after")).toBe("cur-1");
    expect(parsed.searchParams.get("status")).toBe("qualified");
    expect(parsed.searchParams.get("search")).toBe("منى 0100");
  });

  it("omits status, search and after when they are not given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, EMPTY_PAGE));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLeadsPage({ first: 20 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/leads?first=20");
  });

  it("maps 401 and 403 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await fetchLeadsPage({})).toEqual({ outcome: "unauthorized" });
  });

  it("maps a server failure, a network failure and a wrong shape to error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect((await fetchLeadsPage({})).outcome).toBe("error");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect((await fetchLeadsPage({})).outcome).toBe("error");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { nope: true })));
    expect((await fetchLeadsPage({})).outcome).toBe("error");
  });
});

describe("fetchLead", () => {
  it("returns the lead on GET /api/v1/leads/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, LEAD));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLead("lead 1");

    expect(result).toEqual({ outcome: "ok", lead: LEAD });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/leads/lead%201",
    );
  });

  it("maps 404 to not_found and 401 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect(await fetchLead("x")).toEqual({ outcome: "not_found" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, {})));
    expect(await fetchLead("x")).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchLeadExportRows", () => {
  it("reads GET /api/v1/leads/export-rows with after and status only (the API fixes the page at 250)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, EMPTY_PAGE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLeadExportRows({ after: "c9", status: "spam" });

    expect(result).toEqual({ outcome: "ok", items: [], pageInfo: EMPTY_PAGE.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/leads/export-rows?after=c9&status=spam");
  });

  it("sends no query when nothing is asked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, EMPTY_PAGE));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLeadExportRows({});
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/leads/export-rows",
    );
  });

  it("maps 403 to unauthorized and 500 to error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await fetchLeadExportRows({})).toEqual({ outcome: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect((await fetchLeadExportRows({})).outcome).toBe("error");
  });
});

describe("changeLeadStatus", () => {
  it("POSTs { status } to /api/v1/leads/:id/status with the Idempotency-Key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...LEAD, status: "contacted" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await changeLeadStatus("lead-1", "contacted", "key-1");

    expect(result).toEqual({ outcome: "ok", data: { ...LEAD, status: "contacted" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/leads/lead-1/status");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ status: "contacted" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("maps 403, 404, 409 and 422 to their outcomes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await changeLeadStatus("l", "new", "k")).toEqual({ outcome: "forbidden" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect(await changeLeadStatus("l", "new", "k")).toEqual({ outcome: "not_found" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { message: "busy" })));
    expect(await changeLeadStatus("l", "new", "k")).toEqual({
      outcome: "conflict",
      message: "busy",
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(422, { message: "bad", fields: [{ field: "status", message: "no" }] }),
        ),
    );
    expect(await changeLeadStatus("l", "new", "k")).toEqual({
      outcome: "invalid",
      message: "bad",
      fields: [{ field: "status", message: "no" }],
    });
  });
});
