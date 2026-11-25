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
  changeStaffRole,
  fetchStaff,
  inviteStaff,
  isStaffMemberView,
  resendStaffInvitation,
  revokeStaffInvitation,
  setStaffActive,
} = await import("./staff");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const owner = {
  principalExternalId: "0b0a0000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  role: "owner",
  status: "active",
  isOwner: true,
  isSelf: true,
  addedAt: "2026-11-01T10:00:00.000Z",
  lastSignInAt: "2026-11-24T08:00:00.000Z",
  invitation: null,
};
const invited = {
  principalExternalId: "0b0a0000-0000-4000-8000-000000000002",
  email: "sam@example.com",
  role: "operator",
  status: "invited",
  isOwner: false,
  isSelf: false,
  addedAt: "2026-11-23T10:00:00.000Z",
  lastSignInAt: null,
  invitation: {
    id: "9d0a0000-0000-4000-8000-000000000009",
    expiresAt: "2026-11-30T10:00:00.000Z",
    version: 2,
  },
};

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

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

describe("isStaffMemberView", () => {
  it("accepts exactly the StaffMemberView shape Security produces", () => {
    expect(isStaffMemberView(owner)).toBe(true);
    expect(isStaffMemberView(invited)).toBe(true);
  });

  it.each([
    ["an unknown role", { ...owner, role: "root" }],
    ["an unknown status", { ...owner, status: "gone" }],
    ["a missing email", { ...owner, email: undefined }],
    ["a non-boolean isSelf", { ...owner, isSelf: "yes" }],
    ["a numeric lastSignInAt", { ...owner, lastSignInAt: 5 }],
    ["an invitation without a version", { ...invited, invitation: { id: "x", expiresAt: "y" } }],
    [
      "an invitation with a version of 0",
      { ...invited, invitation: { ...invited.invitation, version: 0 } },
    ],
    ["null", null],
  ])("refuses %s", (_name, value) => {
    expect(isStaffMemberView(value)).toBe(false);
  });
});

describe("fetchStaff", () => {
  it("GETs /staff and validates every row", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [owner, invited] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchStaff()).toEqual({ outcome: "ok", data: { items: [owner, invited] } });
    expect(lastCall(fetchMock)[0]).toBe("http://runtime.test/api/v1/staff");
  });

  it("refuses a body with a malformed row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { items: [{ ...owner, role: "root" }] })),
    );
    expect((await fetchStaff()).outcome).toBe("error");
  });

  it("keeps the HTTP status on a 403 so the page can say who may open it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" })));
    expect(await fetchStaff()).toEqual({ outcome: "unauthorized", status: 403 });
  });
});

describe("staff writes", () => {
  it("inviteStaff POSTs /staff/invitations with the email and role and one Idempotency-Key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { invitationId: "inv-1", principalExternalId: "p-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await inviteStaff({ email: "sam@example.com", role: "viewer" }, "key-1");

    expect(result).toEqual({
      outcome: "ok",
      data: { invitationId: "inv-1", principalExternalId: "p-1" },
    });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/staff/invitations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "sam@example.com", role: "viewer" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("resendStaffInvitation and revokeStaffInvitation encode the id and send the loaded version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { invitationId: "a/b c", version: 3 }))
      .mockResolvedValueOnce(jsonResponse(200, { invitationId: "a/b c" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resendStaffInvitation("a/b c", 2, "k-resend")).toEqual({
      outcome: "ok",
      data: { invitationId: "a/b c", version: 3 },
    });
    let [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/staff/invitations/a%2Fb%20c/resend");
    expect(JSON.parse(String(init.body))).toEqual({ expectedVersion: 2 });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k-resend");

    expect(await revokeStaffInvitation("a/b c", 3, "k-revoke")).toEqual({
      outcome: "ok",
      data: { invitationId: "a/b c" },
    });
    [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/staff/invitations/a%2Fb%20c/revoke");
    expect(JSON.parse(String(init.body))).toEqual({ expectedVersion: 3 });
  });

  it("changeStaffRole and setStaffActive encode the principal id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { role: "admin" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "deactivated" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "active" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await changeStaffRole("p/1 x", "admin", "k1")).toEqual({
      outcome: "ok",
      data: { role: "admin" },
    });
    let [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/staff/p%2F1%20x/role");
    expect(JSON.parse(String(init.body))).toEqual({ role: "admin" });

    expect(await setStaffActive("p/1 x", false, "k2")).toEqual({
      outcome: "ok",
      data: { status: "deactivated" },
    });
    [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/staff/p%2F1%20x/active");
    expect(JSON.parse(String(init.body))).toEqual({ active: false });

    expect(await setStaffActive("p/1 x", true, "k3")).toEqual({
      outcome: "ok",
      data: { status: "active" },
    });
  });

  it("keeps a 409's exact message and a 503 / 502's code and status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(409, {
          code: "CONFLICT",
          message: "This email already has a pending invitation",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(503, {
          code: "NOT_CONFIGURED",
          message: "Email isn't set up, so invitations can't be sent",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(502, {
          code: "EMAIL_FAILED",
          message: "The invitation was saved but the email couldn't be sent. Use Resend.",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(403, { code: "AUTHORIZATION" }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { email: "a@b.co", role: "viewer" } as const;

    expect(await inviteStaff(body, "k")).toEqual({
      outcome: "conflict",
      message: "This email already has a pending invitation",
      code: "CONFLICT",
    });
    expect(await inviteStaff(body, "k")).toMatchObject({
      outcome: "error",
      status: 503,
      code: "NOT_CONFIGURED",
    });
    expect(await inviteStaff(body, "k")).toMatchObject({
      outcome: "error",
      status: 502,
      code: "EMAIL_FAILED",
    });
    expect(await inviteStaff(body, "k")).toEqual({ outcome: "forbidden" });
  });

  it("refuses a success body of the wrong shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { role: "root" })));
    expect((await changeStaffRole("p", "admin", "k")).outcome).toBe("error");
  });
});
