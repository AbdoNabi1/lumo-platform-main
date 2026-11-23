import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@platform/contracts";
import { RoleTableAccessControl } from "@platform/auth";
import type { OutreachController } from "@platform/outreach";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { AdminGuard } from "./admin-guard";
import { OUTREACH_TEST_EMAIL, OutreachAdminController } from "./outreach.admin-controller";

const principal = (role: string, kind: Principal["kind"] = "staff"): Principal => ({
  id: `${role}-1`,
  kind,
  roles: [role],
  tenantId: "t-1",
});
const admin = principal("admin");
const operator = principal("operator");
const viewer = principal("viewer");
const customer = principal("admin", "customer");

const ok = (body: unknown = {}) => ({ status: 200, body });

type Stub = { [K in keyof OutreachController]: ReturnType<typeof vi.fn> };
function stubController(): { stub: Stub; controller: OutreachController } {
  const stub = {
    getConnection: vi.fn().mockResolvedValue(ok({ available: true, status: "connected" })),
    connect: vi.fn().mockResolvedValue(ok()),
    refresh: vi.fn().mockResolvedValue(ok()),
    disconnect: vi.fn().mockResolvedValue(ok()),
    abandonOnboarding: vi.fn().mockResolvedValue(ok()),
    listTemplates: vi.fn().mockResolvedValue(ok([])),
    syncTemplates: vi.fn().mockResolvedValue(ok([])),
    createTemplate: vi.fn().mockResolvedValue({ status: 201, body: {} }),
    deleteTemplate: vi.fn().mockResolvedValue(ok()),
    upsertContact: vi.fn().mockResolvedValue(ok({ id: "contact-1" })),
    recordConsent: vi.fn().mockResolvedValue(ok()),
    sendTemplate: vi.fn().mockResolvedValue(ok({ status: "accepted" })),
    sendSessionMessage: vi.fn().mockResolvedValue(ok()),
    sendEmail: vi.fn().mockResolvedValue(ok({ status: "accepted" })),
    getEmailSettings: vi.fn().mockResolvedValue(ok({ available: false })),
  } satisfies Stub;
  return { stub, controller: stub as unknown as OutreachController };
}

function build(signup?: { appId: string; configId: string; graphApiVersion: string }) {
  const { stub, controller } = stubController();
  const audit = new InMemoryAuditTrail();
  const guard = new AdminGuard({
    accessControl: new RoleTableAccessControl(),
    auditTrail: audit,
    clock: { now: () => new Date("2026-11-20T10:00:00.000Z") },
  });
  return {
    stub,
    audit,
    admin: new OutreachAdminController({
      outreach: controller,
      guard,
      ...(signup === undefined ? {} : { signup }),
    }),
  };
}

const draft = {
  name: "promo_one",
  language: "en",
  category: "MARKETING" as const,
  body: { text: "Hi {{1}}", examples: ["Sara"] },
};

describe("OutreachAdminController: manage is denied when called directly", () => {
  const manage: ReadonlyArray<
    readonly [
      string,
      (c: OutreachAdminController, p: Principal) => Promise<{ status: number }>,
      keyof Stub,
    ]
  > = [
    [
      "connect",
      (c, p) => c.connect(p, { tenantId: "t-1", code: "c", wabaId: "w", phoneNumberId: "p" }),
      "connect",
    ],
    ["refresh", (c, p) => c.refresh(p, { tenantId: "t-1" }), "refresh"],
    [
      "disconnect",
      (c, p) => c.disconnect(p, { tenantId: "t-1", expectedVersion: 1 }),
      "disconnect",
    ],
    [
      "abandonOnboarding",
      (c, p) => c.abandonOnboarding(p, { tenantId: "t-1", expectedVersion: 1 }),
      "abandonOnboarding",
    ],
    ["syncTemplates", (c, p) => c.syncTemplates(p, { tenantId: "t-1" }), "syncTemplates"],
    ["createTemplate", (c, p) => c.createTemplate(p, { tenantId: "t-1", draft }), "createTemplate"],
    [
      "deleteTemplate",
      (c, p) => c.deleteTemplate(p, { tenantId: "t-1", name: "promo_one" }),
      "deleteTemplate",
    ],
  ];

  it.each(manage)(
    "%s: operator, viewer and a customer get 403 and the context is not called; admin passes",
    async (_n, call, method) => {
      expect.hasAssertions();
      for (const denied of [operator, viewer, customer]) {
        const { stub, admin: controller } = build();
        const res = await call(controller, denied);
        expect(res.status).toBe(403);
        expect(stub[method]).not.toHaveBeenCalled();
      }
      const { stub, admin: controller } = build();
      const res = await call(controller, admin);
      expect(res.status).toBeLessThan(300);
      expect(stub[method]).toHaveBeenCalledTimes(1);
    },
  );

  it("every decision (allow and deny) is audited by the guard", async () => {
    expect.hasAssertions();
    const { admin: controller, audit } = build();
    await controller.refresh(operator, { tenantId: "t-1" });
    await controller.refresh(admin, { tenantId: "t-1" });
    expect(audit.snapshot().map((e) => `${e.permission}:${e.decision}`)).toEqual([
      "outreach:manage:deny",
      "outreach:manage:allow",
    ]);
  });
});

describe("OutreachAdminController: read and send permissions", () => {
  it("read is open to viewer and operator, closed to a customer", async () => {
    expect.hasAssertions();
    for (const allowed of [viewer, operator, admin]) {
      const { admin: controller } = build();
      expect((await controller.getConnection(allowed, { tenantId: "t-1" })).status).toBe(200);
      expect((await controller.listTemplates(allowed, { tenantId: "t-1" })).status).toBe(200);
      expect((await controller.getEmailSettings(allowed, { tenantId: "t-1" })).status).toBe(200);
    }
    const { stub, admin: controller } = build();
    expect((await controller.getConnection(customer, { tenantId: "t-1" })).status).toBe(403);
    expect((await controller.listTemplates(customer, { tenantId: "t-1" })).status).toBe(403);
    expect((await controller.getEmailSettings(customer, { tenantId: "t-1" })).status).toBe(403);
    expect(stub.getConnection).not.toHaveBeenCalled();
  });

  it("send is open to operator and admin, closed to a viewer", async () => {
    expect.hasAssertions();
    const send = {
      tenantId: "t-1",
      to: "+201012345678",
      templateName: "order_shipped",
      language: "en",
      values: { body: ["Sara"] },
      idempotencyKey: "k-1",
    };
    for (const denied of [viewer, customer]) {
      const { stub, admin: controller } = build();
      expect((await controller.testSendWhatsApp(denied, send)).status).toBe(403);
      expect(
        (
          await controller.testSendEmail(denied, {
            tenantId: "t-1",
            to: "a@b.co",
            idempotencyKey: "k",
          })
        ).status,
      ).toBe(403);
      expect(stub.sendTemplate).not.toHaveBeenCalled();
      expect(stub.sendEmail).not.toHaveBeenCalled();
    }
    for (const allowed of [operator, admin]) {
      const { stub, admin: controller } = build();
      expect((await controller.testSendWhatsApp(allowed, send)).status).toBe(200);
      expect(
        (
          await controller.testSendEmail(allowed, {
            tenantId: "t-1",
            to: "a@b.co",
            idempotencyKey: "k",
          })
        ).status,
      ).toBe(200);
      expect(stub.sendTemplate).toHaveBeenCalledTimes(1);
      expect(stub.sendEmail).toHaveBeenCalledTimes(1);
    }
  });
});

describe("OutreachAdminController: signup values", () => {
  const signup = { appId: "1", configId: "cfg", graphApiVersion: "v24.0" };

  it("adds the non-secret signup object only when the connection is available", async () => {
    expect.hasAssertions();
    const available = build(signup);
    expect((await available.admin.getConnection(viewer, { tenantId: "t-1" })).body).toEqual({
      available: true,
      status: "connected",
      signup,
    });
    const unavailable = build(signup);
    unavailable.stub.getConnection.mockResolvedValue(
      ok({ available: false, status: "not_connected" }),
    );
    expect((await unavailable.admin.getConnection(viewer, { tenantId: "t-1" })).body).toEqual({
      available: false,
      status: "not_connected",
    });
    const unconfigured = build();
    expect((await unconfigured.admin.getConnection(viewer, { tenantId: "t-1" })).body).toEqual({
      available: true,
      status: "connected",
    });
  });
});

describe("OutreachAdminController: test sends", () => {
  const send = {
    tenantId: "t-1",
    to: "+201012345678",
    templateName: "order_shipped",
    language: "en",
    values: { body: ["Sara"], header: "Hi", urlSuffixes: { "0": "abc" } },
    idempotencyKey: "k-1",
  };

  it("attestConsent = upsertContact, then an admin transactional recordConsent (once-only key), then sendTemplate", async () => {
    expect.hasAssertions();
    const { stub, admin: controller } = build();
    const order: string[] = [];
    stub.upsertContact.mockImplementation(async () => {
      order.push("upsert");
      return ok({ id: "contact-9" });
    });
    stub.recordConsent.mockImplementation(async () => {
      order.push("consent");
      return ok();
    });
    stub.sendTemplate.mockImplementation(async () => {
      order.push("send");
      return ok({ status: "accepted" });
    });
    const res = await controller.testSendWhatsApp(operator, { ...send, attestConsent: true });
    expect(res.status).toBe(200);
    expect(order).toEqual(["upsert", "consent", "send"]);
    expect(stub.upsertContact).toHaveBeenCalledWith("t-1", { phone: "+201012345678" });
    expect(stub.recordConsent).toHaveBeenCalledWith("t-1", {
      contactId: "contact-9",
      channel: "whatsapp",
      purpose: "transactional",
      action: "grant",
      source: "admin",
      evidence: "test send attestation by operator-1",
      operationKey: "test-send:k-1",
    });
    expect(stub.sendTemplate).toHaveBeenCalledWith("t-1", {
      to: "+201012345678",
      templateName: "order_shipped",
      language: "en",
      // the route's string keys become button indexes
      values: { body: ["Sara"], header: "Hi", urlSuffixes: { 0: "abc" } },
      idempotencyKey: "k-1",
    });
  });

  it("the grant is transactional whatever the template's category: a marketing template gets no marketing grant", async () => {
    expect.hasAssertions();
    const { stub, admin: controller } = build();
    stub.sendTemplate.mockResolvedValue({ status: 409, body: { code: "CONFLICT" } });
    const res = await controller.testSendWhatsApp(operator, { ...send, attestConsent: true });
    expect(res.status).toBe(409);
    expect(stub.recordConsent).toHaveBeenCalledTimes(1);
    expect(stub.recordConsent.mock.calls[0]?.[1]).toMatchObject({
      purpose: "transactional",
      action: "grant",
      source: "admin",
    });
    // no template lookup decides the purpose any more
    expect(stub.listTemplates).not.toHaveBeenCalled();
  });

  it("without attestConsent no contact is upserted and no consent is recorded", async () => {
    expect.hasAssertions();
    const { stub, admin: controller } = build();
    await controller.testSendWhatsApp(operator, send);
    expect(stub.upsertContact).not.toHaveBeenCalled();
    expect(stub.recordConsent).not.toHaveBeenCalled();
    expect(stub.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("the grant is retained when the send is then refused (explicit operator evidence, not delivery) and nothing else is granted", async () => {
    expect.hasAssertions();
    const { stub, admin: controller } = build();
    stub.sendTemplate.mockResolvedValue({ status: 409, body: { code: "CONFLICT" } });
    const res = await controller.testSendWhatsApp(operator, { ...send, attestConsent: true });
    expect(res.status).toBe(409);
    expect(stub.upsertContact).toHaveBeenCalledTimes(1);
    expect(stub.recordConsent).toHaveBeenCalledTimes(1);
    expect(stub.recordConsent.mock.calls[0]?.[1]).toMatchObject({
      evidence: "test send attestation by operator-1",
    });
  });

  it("the once-only operation key is the submission key: a new submission key is a new operation", async () => {
    expect.hasAssertions();
    const { stub, admin: controller } = build();
    await controller.testSendWhatsApp(operator, { ...send, attestConsent: true });
    await controller.testSendWhatsApp(operator, {
      ...send,
      attestConsent: true,
      idempotencyKey: "k-2",
    });
    expect(
      stub.recordConsent.mock.calls.map(
        (call) => (call[1] as { operationKey: string }).operationKey,
      ),
    ).toEqual(["test-send:k-1", "test-send:k-2"]);
  });

  it("a failed contact upsert or consent write stops before the send and is returned as is", async () => {
    expect.hasAssertions();
    const failedUpsert = build();
    failedUpsert.stub.upsertContact.mockResolvedValue({
      status: 422,
      body: { code: "VALIDATION" },
    });
    expect(
      (await failedUpsert.admin.testSendWhatsApp(operator, { ...send, attestConsent: true }))
        .status,
    ).toBe(422);
    expect(failedUpsert.stub.sendTemplate).not.toHaveBeenCalled();

    const failedConsent = build();
    failedConsent.stub.recordConsent.mockResolvedValue({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
    expect(
      (await failedConsent.admin.testSendWhatsApp(operator, { ...send, attestConsent: true }))
        .status,
    ).toBe(404);
    expect(failedConsent.stub.sendTemplate).not.toHaveBeenCalled();
  });

  it("the email test is the fixed bilingual transactional message with the caller's key", async () => {
    expect.hasAssertions();
    const { stub, admin: controller } = build();
    await controller.testSendEmail(operator, {
      tenantId: "t-1",
      to: "owner@example.com",
      idempotencyKey: "m-1",
    });
    expect(stub.sendEmail).toHaveBeenCalledWith("t-1", {
      to: "owner@example.com",
      subject: OUTREACH_TEST_EMAIL.subject,
      html: OUTREACH_TEST_EMAIL.html,
      text: OUTREACH_TEST_EMAIL.text,
      purpose: "transactional",
      idempotencyKey: "m-1",
    });
    expect(OUTREACH_TEST_EMAIL.subject).toMatch(/[\u0600-\u06FF]/);
    expect(OUTREACH_TEST_EMAIL.subject).toMatch(/[A-Za-z]/);
  });
});
