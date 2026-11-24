import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ getAdminApi: vi.fn(), mutateAdminApi: vi.fn() }));
vi.mock("./client", () => client);
import {
  abandonWhatsAppOnboarding,
  connectWhatsApp,
  disconnectWhatsApp,
  fetchWhatsAppConnection,
  fetchWhatsAppTemplates,
  isSendResultDto,
  isWhatsAppConnectionDto,
  isWhatsAppTemplateDto,
  isWhatsAppTemplateList,
  refreshWhatsApp,
  sendWhatsAppTest,
  type WhatsAppConnectionDto,
} from "./outreach";

/** A GET /outreach/whatsapp body as `connectionDto` in services/outreach produces it. */
const connected = {
  available: true,
  status: "connected",
  displayPhoneNumber: "+20 100 123 4567",
  verifiedName: "Nour Store",
  qualityRating: "GREEN",
  messagingLimitTier: "TIER_250",
  connectedAt: "2026-11-20T10:00:00.000Z",
  lastError: null,
  onboardingFailure: null,
  onboardingStage: null,
  version: 3,
  signup: { appId: "123456", configId: "987654", graphApiVersion: "v24.0" },
};

/** A GET /outreach/whatsapp/templates element as `templateDto` produces it: a header variable, and a URL button at index 2. */
const presenterTemplate = {
  name: "order_update",
  language: "en",
  category: "UTILITY",
  status: "APPROVED",
  rejectedReason: null,
  components: [
    { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
    { type: "BODY", text: "Hi {{1}}, your order {{2}} shipped." },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Thanks" },
        { type: "PHONE_NUMBER", text: "Call", phone_number: "+201000000000" },
        { type: "URL", text: "Track", url: "https://shop.example/track/{{1}}" },
      ],
    },
  ],
  variableCount: 2,
  buttons: [
    { type: "QUICK_REPLY", text: "Thanks" },
    { type: "PHONE_NUMBER", text: "Call" },
    { type: "URL", text: "Track" },
  ],
  supported: true,
  sendShape: {
    bodyVariableCount: 2,
    headerHasVariable: true,
    buttons: [{ index: 2, type: "URL", urlHasVariable: true }],
  },
};

beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
});

describe("isWhatsAppConnectionDto", () => {
  it("accepts every status the API can send", () => {
    expect.hasAssertions();
    for (const status of ["connected", "disconnected", "error", "not_connected", "onboarding"]) {
      expect(isWhatsAppConnectionDto({ ...connected, status })).toBe(true);
    }
  });

  it("accepts the unavailable shape, which carries no signup block", () => {
    expect.hasAssertions();
    const { signup: _signup, ...rest } = connected;
    expect(
      isWhatsAppConnectionDto({
        ...rest,
        available: false,
        status: "not_connected",
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        messagingLimitTier: null,
        connectedAt: null,
        version: 0,
      }),
    ).toBe(true);
  });

  it.each([
    ["an unknown status", { status: "weird" }],
    ["a non-boolean available", { available: "yes" }],
    ["a missing version", { version: undefined }],
    ["a fractional version", { version: 1.5 }],
    ["an unknown onboarding stage", { onboardingStage: "halfway" }],
    ["a signup block without a config id", { signup: { appId: "1", graphApiVersion: "v24.0" } }],
    ["a numeric display phone", { displayPhoneNumber: 15 }],
  ])("rejects %s", (_name, change) => {
    expect.hasAssertions();
    expect(isWhatsAppConnectionDto({ ...connected, ...change })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect.hasAssertions();
    expect(isWhatsAppConnectionDto(null)).toBe(false);
    expect(isWhatsAppConnectionDto([])).toBe(false);
    expect(isWhatsAppConnectionDto("connected")).toBe(false);
  });
});

describe("template guard (R2-B06: supported + sendShape)", () => {
  it("accepts a presenter-shaped template with a header variable and a URL button at index 2", () => {
    expect.hasAssertions();
    expect(isWhatsAppTemplateDto(presenterTemplate)).toBe(true);
    expect(isWhatsAppTemplateList([presenterTemplate])).toBe(true);
  });

  it("rejects a template without sendShape or supported", () => {
    expect.hasAssertions();
    const { sendShape: _s, ...noShape } = presenterTemplate;
    const { supported: _u, ...noSupported } = presenterTemplate;
    expect(isWhatsAppTemplateDto(noShape)).toBe(false);
    expect(isWhatsAppTemplateDto(noSupported)).toBe(false);
  });

  it("rejects a send shape whose button is malformed", () => {
    expect.hasAssertions();
    expect(
      isWhatsAppTemplateDto({
        ...presenterTemplate,
        sendShape: { ...presenterTemplate.sendShape, buttons: [{ index: "2", type: "URL" }] },
      }),
    ).toBe(false);
  });

  it("rejects a list with one bad element", () => {
    expect.hasAssertions();
    expect(isWhatsAppTemplateList([presenterTemplate, { name: "x" }])).toBe(false);
    expect(isWhatsAppTemplateList("nope")).toBe(false);
  });
});

describe("isSendResultDto", () => {
  const sendResult = {
    outboundId: "out-1",
    status: "accepted",
    providerMessageId: "wamid.1",
    acceptedAt: "2026-11-20T10:00:00.000Z",
    errorCode: null,
  };

  it("accepts every outbound status", () => {
    expect.hasAssertions();
    for (const status of [
      "pending",
      "accepted",
      "sent",
      "delivered",
      "read",
      "failed",
      "unknown",
      "suppressed",
    ]) {
      expect(isSendResultDto({ ...sendResult, status })).toBe(true);
    }
  });

  it("rejects an unknown status and a missing outbound id", () => {
    expect.hasAssertions();
    expect(isSendResultDto({ ...sendResult, status: "sentish" })).toBe(false);
    expect(isSendResultDto({ ...sendResult, outboundId: undefined })).toBe(false);
  });
});

describe("reads project the DTO", () => {
  it("fetchWhatsAppConnection drops fields the screen does not show", async () => {
    expect.hasAssertions();
    client.getAdminApi.mockResolvedValue({
      outcome: "ok",
      data: {
        ...connected,
        phoneNumberId: "111222333",
        wabaId: "444555666",
        sealedCredentials: "x",
      },
    });
    const result = await fetchWhatsAppConnection();
    expect(client.getAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp",
      isWhatsAppConnectionDto,
    );
    expect(result).toEqual({ outcome: "ok", data: connected });
    expect(JSON.stringify(result)).not.toMatch(/111222333|444555666|sealed/);
  });

  it("fetchWhatsAppTemplates keeps the send shape and drops the raw components", async () => {
    expect.hasAssertions();
    client.getAdminApi.mockResolvedValue({ outcome: "ok", data: [presenterTemplate] });
    const result = await fetchWhatsAppTemplates();
    expect(client.getAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp/templates",
      isWhatsAppTemplateList,
    );
    expect(result.outcome === "ok" && result.data[0]).toEqual({
      name: "order_update",
      language: "en",
      category: "UTILITY",
      status: "APPROVED",
      variableCount: 2,
      supported: true,
      sendShape: presenterTemplate.sendShape,
    });
  });

  it("passes failures through untouched", async () => {
    expect.hasAssertions();
    client.getAdminApi.mockResolvedValue({ outcome: "unauthorized" });
    expect(await fetchWhatsAppConnection()).toEqual({ outcome: "unauthorized" });
    expect(await fetchWhatsAppTemplates()).toEqual({ outcome: "unauthorized" });
  });
});

describe("writes", () => {
  beforeEach(() => {
    client.mutateAdminApi.mockResolvedValue({ outcome: "ok", data: connected });
  });

  it("connect posts the three values with a long timeout and the idempotency key", async () => {
    expect.hasAssertions();
    await connectWhatsApp({ code: "c", wabaId: "1", phoneNumberId: "2" }, "k1");
    expect(client.mutateAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp/connect",
      {
        method: "POST",
        body: { code: "c", wabaId: "1", phoneNumberId: "2" },
        idempotencyKey: "k1",
        timeoutMs: 60_000,
      },
      isWhatsAppConnectionDto,
    );
  });

  it("refresh, disconnect and abandon hit their own routes", async () => {
    expect.hasAssertions();
    await refreshWhatsApp("k2");
    await disconnectWhatsApp(4, "k3");
    await abandonWhatsAppOnboarding(5, "k4");
    const calls = client.mutateAdminApi.mock.calls.map((c) => [
      c[0],
      (c[1] as { body?: unknown }).body,
      (c[1] as { idempotencyKey: string }).idempotencyKey,
    ]);
    expect(calls).toEqual([
      ["/api/v1/outreach/whatsapp/refresh", undefined, "k2"],
      ["/api/v1/outreach/whatsapp/disconnect", { expectedVersion: 4 }, "k3"],
      ["/api/v1/outreach/whatsapp/onboarding/abandon", { expectedVersion: 5 }, "k4"],
    ]);
  });

  it("test-send posts the whole input with the caller's key", async () => {
    expect.hasAssertions();
    const input = {
      to: "+201001234567",
      templateName: "order_update",
      language: "en",
      values: { body: ["Mona", "1001"], header: "1001", urlSuffixes: { "2": "abc" } },
      attestConsent: true,
    };
    await sendWhatsAppTest(input, "key-9");
    expect(client.mutateAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp/test-send",
      expect.objectContaining({ method: "POST", body: input, idempotencyKey: "key-9" }),
      isSendResultDto,
    );
  });
});

it("the connection type is usable as a plain object", () => {
  expect.hasAssertions();
  const dto: WhatsAppConnectionDto = connected as WhatsAppConnectionDto;
  expect(dto.signup?.graphApiVersion).toBe("v24.0");
});
