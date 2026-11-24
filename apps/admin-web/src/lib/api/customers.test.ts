import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const {
  changeMarketingConsent,
  createCustomer,
  fetchCustomer,
  fetchCustomerExportPage,
  fetchCustomersPage,
  setCustomerNote,
  setCustomerTags,
  updateCustomerProfile,
} = await import("./customers");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const detail = {
  id: "c-1",
  name: "Nour Hassan",
  email: "nour@example.com",
  addresses: [{ line1: "1 Nile St", city: "Cairo", postalCode: "11511", country: "EG" }],
  consents: [{ scope: "marketing", granted: true, occurredAt: "2026-11-01T10:00:00.000Z" }],
  phone: "+201001234567",
  language: "ar" as const,
  isGuest: false,
  note: "VIP",
  tags: ["Cairo", "VIP"],
  marketing: { email: true, sms: false },
};

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

describe("fetchCustomersPage (unchanged shape)", () => {
  it("requests first/after/search and returns ok + items + pageInfo", async () => {
    const page = {
      items: [{ id: "c-1", name: "Nour", email: "n@example.com" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomersPage({ first: 20, after: "a b", search: "nour" });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/customers?first=20&after=a+b&search=nour",
    );
  });
});

describe("fetchCustomersPage with a segment (Shopify parity Wave 1c)", () => {
  const page = {
    items: [{ id: "c-1", name: "Nour", email: "n@example.com" }],
    pageInfo: { hasNextPage: true, endCursor: "c-1" },
  };

  it("sends segmentId alongside first/after/search, encoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomersPage({
      first: 20,
      after: "c-0",
      search: "nour",
      segmentId: "default:not_purchased",
    });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/customers?first=20&after=c-0&search=nour&segmentId=default%3Anot_purchased",
    );
  });

  it("sends no segmentId when none is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCustomersPage({ first: 20 });

    expect((fetchMock.mock.calls[0] as [string])[0]).not.toContain("segmentId");
  });

  it("a 404 for a segment is not_found; without a segment it stays the old error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" })));
    expect(await fetchCustomersPage({ segmentId: "gone" })).toEqual({ outcome: "not_found" });
    expect(await fetchCustomersPage({})).toEqual({ outcome: "error", message: "Not found" });
  });

  it("503 + UNAVAILABLE with a segment is unavailable; any other failure is the generic error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(503, { code: "UNAVAILABLE", message: "needs db" })),
    );
    expect(await fetchCustomersPage({ segmentId: "s-1" })).toEqual({ outcome: "unavailable" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, { message: "down" })));
    expect(await fetchCustomersPage({ segmentId: "s-1" })).toMatchObject({ outcome: "error" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNAVAILABLE" })));
    expect(await fetchCustomersPage({ segmentId: "s-1" })).toMatchObject({ outcome: "error" });
  });

  it("403 is unauthorized with or without a segment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await fetchCustomersPage({ segmentId: "s-1" })).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchCustomer", () => {
  it("returns the extended detail DTO, encoding the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, detail));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomer("c 1/x");

    expect(result).toEqual({ outcome: "ok", customer: detail });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/customers/c%201%2Fx",
    );
  });

  it("accepts a customer with no phone, language or note, and no tags", async () => {
    const bare = {
      ...detail,
      phone: null,
      language: null,
      note: null,
      tags: [],
      isGuest: true,
      marketing: { email: false, sms: false },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, bare)));

    expect(await fetchCustomer("c-1")).toEqual({ outcome: "ok", customer: bare });
  });

  it.each([
    ["phone missing", { phone: undefined }],
    ["phone a number", { phone: 5 }],
    ["language fr", { language: "fr" }],
    ["language missing", { language: undefined }],
    ["isGuest a string", { isGuest: "no" }],
    ["note a number", { note: 3 }],
    ["tags not an array", { tags: "VIP" }],
    ["a tag that is not a string", { tags: ["VIP", 4] }],
    ["marketing missing", { marketing: undefined }],
    ["marketing.sms missing", { marketing: { email: true } }],
    ["marketing.email a string", { marketing: { email: "yes", sms: false } }],
    ["addresses not an array", { addresses: null }],
    ["an address without a city", { addresses: [{ line1: "1", postalCode: "1", country: "EG" }] }],
    ["consents not an array", { consents: {} }],
    ["a consent without granted", { consents: [{ scope: "marketing", occurredAt: "x" }] }],
    ["name missing", { name: undefined }],
  ])("refuses a body where %s", async (_label, patch) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ...detail, ...patch })));

    const result = await fetchCustomer("c-1");

    expect(result.outcome).toBe("error");
  });

  it("maps 404 to not_found and 403 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(404, {})));
    expect(await fetchCustomer("c-1")).toEqual({ outcome: "not_found" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(403, {})));
    expect(await fetchCustomer("c-1")).toEqual({ outcome: "unauthorized" });
  });
});

function lastCall(fetchMock: ReturnType<typeof vi.fn>): {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
} {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("createCustomer", () => {
  it("POSTs the whole body with the idempotency key and returns the new id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { customerId: "c-9" }));
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      name: "Nour Hassan",
      email: "nour@example.com",
      phone: "+201001234567",
      language: "ar" as const,
      note: "VIP",
      tags: ["a, b"],
      marketingEmail: true,
      marketingSms: false,
    };

    const result = await createCustomer(body, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { customerId: "c-9" } });
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps the duplicate-email 409 to conflict with the exact message and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          code: "CONFLICT",
          message: "A customer with this email already exists",
        }),
      ),
    );

    expect(await createCustomer({ name: "N", email: "n@example.com" }, "k")).toEqual({
      outcome: "conflict",
      message: "A customer with this email already exists",
      code: "CONFLICT",
    });
  });

  it("maps a 422 to invalid with the field issues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          code: "VALIDATION",
          message: "Validation failed",
          fields: [{ field: "phone", message: "Enter a valid phone number" }],
        }),
      ),
    );

    expect(await createCustomer({ name: "N", email: "n@example.com", phone: "x" }, "k")).toEqual({
      outcome: "invalid",
      message: "Validation failed",
      fields: [{ field: "phone", message: "Enter a valid phone number" }],
      code: "VALIDATION",
    });
  });

  it("maps 403 to forbidden and refuses a 201 whose body has no customerId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(403, { code: "FORBIDDEN" })));
    expect(await createCustomer({ name: "N", email: "n@example.com" }, "k")).toEqual({
      outcome: "forbidden",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(201, { id: "c-9" })));
    expect((await createCustomer({ name: "N", email: "n@example.com" }, "k")).outcome).toBe(
      "error",
    );
  });
});

describe("updateCustomerProfile", () => {
  it("POSTs only the given keys, nulls included, to /customers/:id (encoded)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { customerId: "c 1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateCustomerProfile("c 1", { phone: null, language: null }, "k2");

    expect(result).toEqual({ outcome: "ok", data: { customerId: "c 1" } });
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customers/c%201");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ phone: null, language: null });
    expect(headers["idempotency-key"]).toBe("k2");
  });

  it("maps 404 to not_found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect(await updateCustomerProfile("c-1", { name: "N" }, "k")).toEqual({
      outcome: "not_found",
    });
  });
});

describe("setCustomerNote", () => {
  it("POSTs {note} to /note, encoding the id; null clears", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { customerId: "c/1", note: null }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setCustomerNote("c/1", null, "k3");

    expect(result).toEqual({ outcome: "ok", data: { customerId: "c/1", note: null } });
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customers/c%2F1/note");
    expect(JSON.parse(init.body as string)).toEqual({ note: null });
    expect(headers["idempotency-key"]).toBe("k3");
  });

  it("refuses a response whose note is neither text nor null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { customerId: "c-1", note: 3 })),
    );
    expect((await setCustomerNote("c-1", "x", "k")).outcome).toBe("error");
  });
});

describe("setCustomerTags", () => {
  it("POSTs {tags} to /tags and returns the stored set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { customerId: "c-1", tags: ["Cairo", "VIP"] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setCustomerTags("c-1", ["VIP", "Cairo"], "k4");

    expect(result).toEqual({ outcome: "ok", data: { customerId: "c-1", tags: ["Cairo", "VIP"] } });
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customers/c-1/tags");
    expect(JSON.parse(init.body as string)).toEqual({ tags: ["VIP", "Cairo"] });
  });

  it("refuses tags that are not all strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { customerId: "c-1", tags: ["a", 1] })),
    );
    expect((await setCustomerTags("c-1", [], "k")).outcome).toBe("error");
  });
});

describe("changeMarketingConsent", () => {
  it("POSTs only the channel that changed to /marketing-consent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { customerId: "c-1", email: false, sms: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await changeMarketingConsent("c-1", { sms: true }, "k5");

    expect(result).toEqual({
      outcome: "ok",
      data: { customerId: "c-1", email: false, sms: true },
    });
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customers/c-1/marketing-consent");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ sms: true });
    expect(headers["idempotency-key"]).toBe("k5");
  });

  it("refuses a response without both booleans", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { customerId: "c-1", email: true })),
    );
    expect((await changeMarketingConsent("c-1", { email: true }, "k")).outcome).toBe("error");
  });
});

describe("fetchCustomerExportPage", () => {
  it("GETs /customers/export-rows with first, after and search encoded", async () => {
    const page = { items: [exportRow], pageInfo: { hasNextPage: true, endCursor: "cur 1" } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomerExportPage({ first: 100, after: "a&b", search: "نور x" });

    expect(result).toEqual({ outcome: "ok", data: page });
    const params = new URL((fetchMock.mock.calls[0] as [string])[0]).searchParams;
    expect(params.get("first")).toBe("100");
    expect(params.get("after")).toBe("a&b");
    expect(params.get("search")).toBe("نور x");
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(
      /^http:\/\/runtime\.test\/api\/v1\/customers\/export-rows\?/,
    );
  });

  it("sends no query string when nothing is asked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchCustomerExportPage({});

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/customers/export-rows",
    );
  });

  it("maps 403 (a viewer) to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" })));
    expect(await fetchCustomerExportPage({})).toEqual({ outcome: "unauthorized" });
  });

  it("accepts a row with no address and rows with null phone/language/note", async () => {
    const page = {
      items: [{ ...exportRow, address: null }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, page)));
    expect(await fetchCustomerExportPage({})).toEqual({ outcome: "ok", data: page });
  });

  it.each([
    ["id missing", { id: undefined }],
    ["email a number", { email: 1 }],
    ["phone undefined", { phone: undefined }],
    ["language fr", { language: "fr" }],
    ["emailMarketing a string", { emailMarketing: "yes" }],
    ["smsMarketing missing", { smsMarketing: undefined }],
    ["tags with a non-string", { tags: [1] }],
    ["note a number", { note: 1 }],
    ["isGuest missing", { isGuest: undefined }],
    ["address without country", { address: { line1: "1", city: "C", postalCode: "1" } }],
    ["address undefined", { address: undefined }],
  ])("refuses a page with a malformed row (%s)", async (_label, patch) => {
    const page = {
      items: [{ ...exportRow, ...patch }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, page)));

    expect((await fetchCustomerExportPage({})).outcome).toBe("error");
  });

  it.each([
    ["pageInfo missing", { items: [] }],
    ["hasNextPage a string", { items: [], pageInfo: { hasNextPage: "no", endCursor: null } }],
    ["endCursor a number", { items: [], pageInfo: { hasNextPage: false, endCursor: 3 } }],
    ["items not an array", { items: {}, pageInfo: { hasNextPage: false, endCursor: null } }],
  ])("refuses a malformed page (%s)", async (_label, page) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, page)));
    expect((await fetchCustomerExportPage({})).outcome).toBe("error");
  });
});
