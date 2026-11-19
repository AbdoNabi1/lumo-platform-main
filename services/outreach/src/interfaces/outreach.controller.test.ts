import { JsonEventSerializer } from "@platform/domain-events";
import { err, ok } from "@platform/types";
import { BusinessRuleError, ConflictError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { wireOutreach } from "../composition";
import { FakeClock, FakeEmailPort, FakeVault, FakeWhatsAppPort } from "../testing/fake-ports";
import { present } from "./presenter";

function wiredOutreach() {
  const clock = new FakeClock(new Date("2026-11-19T10:00:00.000Z"));
  let n = 0;
  const whatsapp = new FakeWhatsAppPort();
  const wired = wireOutreach({
    serializer: new JsonEventSerializer(),
    idGenerator: { generate: () => `id-${(n += 1)}` },
    clock,
    platformTenantId: "platform",
    whatsapp,
    vault: new FakeVault(),
    email: new FakeEmailPort(),
    emailFrom: "no-reply@send.morbeh.com",
    emailCaps: { perHour: 10, perDay: 100 },
    storeProfile: {
      get: () => Promise.resolve({ storeName: "Shop", contactEmail: "o@shop.test" }),
    },
    randomPin: () => "123456",
  });
  return { wired, whatsapp };
}

describe("OutreachController", () => {
  it("has one method per use case and returns the right success statuses", async () => {
    expect.hasAssertions();
    const { wired } = wiredOutreach();
    const o = wired.outreach;
    const t = "tenant-1";
    const connected = await o.connect(t, { code: "c", wabaId: "waba-1", phoneNumberId: "phone-1" });
    const version = (connected.body as { version: number }).version;
    expect((await o.getConnection(t)).status).toBe(200);
    expect((await o.refresh(t)).status).toBe(200);
    expect((await o.listTemplates(t)).status).toBe(200);
    expect((await o.syncTemplates(t)).status).toBe(200);
    expect(
      (
        await o.createTemplate(t, {
          draft: {
            name: "order_update",
            language: "en_US",
            category: "UTILITY",
            body: { text: "Hi {{1}}, thanks", examples: ["Sara"] },
          },
        })
      ).status,
    ).toBe(201);
    expect((await o.deleteTemplate(t, { name: "order_update" })).status).toBe(200);
    expect((await o.upsertContact(t, { email: "a@b.test" })).status).toBe(200);
    const session = await o.sendSessionMessage(t, {
      to: "01012345678",
      text: "hi",
      idempotencyKey: "s1",
    });
    expect(session).toMatchObject({ status: 409, body: { message: "SESSION_WINDOW_CLOSED" } });
    expect(
      (
        await o.sendEmail(t, {
          to: "a@b.test",
          subject: "s",
          html: "<p>x</p>",
          text: "x",
          purpose: "transactional",
          idempotencyKey: "e1",
        })
      ).status,
    ).toBe(200);
    expect(await o.abandonOnboarding(t, { expectedVersion: version })).toMatchObject({
      status: 409,
      body: { message: "ONBOARDING_NOT_ACTIVE" },
    });
    expect((await o.getEmailSettings(t)).status).toBe(200);
    const latest = (await o.getConnection(t)).body as { version: number };
    expect((await o.disconnect(t, { expectedVersion: latest.version })).status).toBe(200);
  });
});

describe("present", () => {
  it("maps ok to the success status and known codes to their transport status", () => {
    expect.hasAssertions();
    expect(present(ok({ a: 1 }), 201)).toEqual({ status: 201, body: { a: 1 } });
    expect(present(err(new ConflictError("PHONE_IN_USE")), 200)).toMatchObject({
      status: 409,
      body: { code: "CONFLICT", message: "PHONE_IN_USE" },
    });
    expect(present(err(new BusinessRuleError("rule")), 200).status).toBe(409);
  });
});
