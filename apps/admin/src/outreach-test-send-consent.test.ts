import { describe, expect, it } from "vitest";
import type { Clock, Principal } from "@platform/contracts";
import { RoleTableAccessControl } from "@platform/auth";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { MetaTemplateRecord, OutreachController } from "@platform/outreach";
import { FakeEmailPort, FakeVault, FakeWhatsAppPort } from "@platform/outreach/testing/fake-ports";
import { wireAdmin } from "./composition";
import { InMemoryAuditTrail } from "./infrastructure/in-memory-audit-trail";

const SHOP = "t-1";
const WABA = "200000000001";
const PHONE = "100000000001";
// Assembled so no literal phone number sits in the source.
const BUYER = `+${["20", "10", "12345679"].join("")}`;
const clock: Clock = { now: () => new Date("2026-11-20T10:00:00.000Z") };
const staff = (role: string): Principal => ({
  id: `${role}-1`,
  kind: "staff",
  roles: [role],
  tenantId: SHOP,
});
const admin = staff("admin");
const operator = staff("operator");

const template = (category: "UTILITY" | "MARKETING", name: string): MetaTemplateRecord => ({
  id: `meta-${name}`,
  name,
  language: "en_US",
  category,
  status: "APPROVED",
  components: [
    {
      type: "BODY",
      text: "Hello {{1}}, your order is on its way",
      example: { body_text: [["Sara"]] },
    },
  ],
  rejectedReason: null,
  qualityScore: null,
});

async function connected(templates: MetaTemplateRecord[]) {
  const whatsapp = new FakeWhatsAppPort();
  whatsapp.templates = templates;
  let counter = 0;
  const wired = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => `id-${(counter += 1)}` },
    clock,
    accessControl: new RoleTableAccessControl(),
    auditTrail: new InMemoryAuditTrail(),
    tenantId: SHOP,
    outreach: {
      whatsapp,
      vault: new FakeVault(),
      email: new FakeEmailPort(),
      emailFrom: "no-reply@morbeh.test",
      randomPin: () => "654321",
    },
  });
  expect(
    (
      await wired.outreach.connect(admin, {
        tenantId: SHOP,
        code: "c",
        wabaId: WABA,
        phoneNumberId: PHONE,
      })
    ).status,
  ).toBe(200);
  expect((await wired.outreach.syncTemplates(admin, { tenantId: SHOP })).status).toBe(200);
  // The unguarded context behind the guarded controller: this test plays the buyer's STOP.
  const context = (wired.outreach as unknown as { outreach: OutreachController }).outreach;
  const send = (templateName: string, idempotencyKey: string, attestConsent: boolean) =>
    wired.outreach.testSendWhatsApp(operator, {
      tenantId: SHOP,
      to: BUYER,
      templateName,
      // the stored template is en_US; the operator types en-US
      language: "en-US",
      values: { body: ["Sara"] },
      idempotencyKey,
      ...(attestConsent ? { attestConsent: true } : {}),
    });
  const stop = async () => {
    const contact = await context.upsertContact(SHOP, { phone: BUYER });
    const contactId = (contact.body as { id: string }).id;
    const revoked = await context.recordConsent(SHOP, {
      contactId,
      channel: "whatsapp",
      purpose: "transactional",
      action: "revoke",
      source: "admin",
      evidence: "buyer sent STOP",
    });
    expect(revoked.status).toBe(200);
  };
  return { whatsapp, send, stop };
}

describe("test-send consent attestation (real wiring, in-memory)", () => {
  it("the grant is transactional: a MARKETING template stays suppressed and nothing is dispatched", async () => {
    expect.hasAssertions();
    const h = await connected([template("MARKETING", "promo_one")]);
    const res = await h.send("promo_one", "k-1", true);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("suppressed");
    expect(h.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("a UTILITY template with the attestation sends, and en-US finds the stored en_US template", async () => {
    expect.hasAssertions();
    const h = await connected([template("UTILITY", "order_shipped")]);
    const res = await h.send("order_shipped", "k-1", true);
    expect((res.body as { status: string }).status).toBe("accepted");
    expect(h.whatsapp.count("sendTemplate")).toBe(1);
  });

  it("a same-key retry after an intervening STOP (cold HTTP cache) stays revoked: no second grant, no second dispatch", async () => {
    expect.hasAssertions();
    const h = await connected([template("UTILITY", "order_shipped")]);
    const first = await h.send("order_shipped", "k-1", true);
    expect((first.body as { status: string }).status).toBe("accepted");
    await h.stop();

    // Calling the controller again is what a cold cache does: only the durable receipts remain.
    const retry = await h.send("order_shipped", "k-1", true);
    expect(retry.status).toBe(200);
    expect(h.whatsapp.count("sendTemplate")).toBe(1);

    // The opt-out is intact: a NEW submission without a fresh attestation is suppressed...
    const without = await h.send("order_shipped", "k-2", false);
    expect((without.body as { status: string }).status).toBe("suppressed");
    expect(h.whatsapp.count("sendTemplate")).toBe(1);
    // ...and only an intentional new submission (new key) with an attestation grants again.
    const renewed = await h.send("order_shipped", "k-3", true);
    expect((renewed.body as { status: string }).status).toBe("accepted");
    expect(h.whatsapp.count("sendTemplate")).toBe(2);
  });
});
