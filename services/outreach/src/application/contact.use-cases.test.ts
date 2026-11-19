import { ConflictError, NotFoundError, ValidationError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { createOutreachKit, T1, T2 } from "../testing/outreach-kit";
import { errorOf, okValue } from "../testing/result-helpers";
import { InMemoryOutreachEventRecorder } from "../testing/in-memory-outreach-event-recorder";
import { RecordConsent, UpsertContact } from "./contact.use-cases";

describe("UpsertContact", () => {
  it("creates a contact with a normalised phone and unknown consent", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const dto = okValue(
      await new UpsertContact(kit.deps).execute({
        tenantId: T1,
        phone: "010 1234 5678",
        displayName: " Sara ",
      }),
    );
    expect(dto.phone).toBe("+201012345678");
    expect(dto.displayName).toBe("Sara");
    expect(dto.whatsappMarketing).toBe("unknown");
    expect(dto.whatsappTransactional).toBe("unknown");
    expect(dto.emailMarketing).toBe("unknown");
  });

  it("lowercases and trims the email and finds the same contact again", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const uc = new UpsertContact(kit.deps);
    const a = okValue(await uc.execute({ tenantId: T1, email: "  Sara@Shop.TEST " }));
    const b = okValue(await uc.execute({ tenantId: T1, email: "sara@shop.test" }));
    expect(a.email).toBe("sara@shop.test");
    expect(b.id).toBe(a.id);
  });

  it("finds by phone first and fills the missing email without touching consent", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const uc = new UpsertContact(kit.deps);
    const created = okValue(await uc.execute({ tenantId: T1, phone: "01012345678" }));
    okValue(
      await new RecordConsent(kit.deps).execute({
        tenantId: T1,
        contactId: created.id,
        channel: "whatsapp",
        purpose: "marketing",
        action: "grant",
        source: "admin",
      }),
    );
    const updated = okValue(
      await uc.execute({
        tenantId: T1,
        phone: "+201012345678",
        email: "a@b.test",
        customerRef: "cust-1",
      }),
    );
    expect(updated.id).toBe(created.id);
    expect(updated.email).toBe("a@b.test");
    expect(updated.customerRef).toBe("cust-1");
    expect(updated.whatsappMarketing).toBe("granted");
  });

  it("rejects an invalid phone without an email, field phone", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const error = errorOf(await new UpsertContact(kit.deps).execute({ tenantId: T1, phone: "12" }));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual([
      { field: "phone", message: "phone_invalid" },
    ]);
  });

  it("never silently drops an invalid identity even when the other one is valid", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const uc = new UpsertContact(kit.deps);
    const badPhone = errorOf(await uc.execute({ tenantId: T1, phone: "x", email: "a@b.test" }));
    const badEmail = errorOf(
      await uc.execute({ tenantId: T1, phone: "01012345678", email: "not-an-email" }),
    );
    expect((badPhone as ValidationError).fields[0]?.field).toBe("phone");
    expect((badEmail as ValidationError).fields[0]?.field).toBe("email");
    expect(kit.mem.store.contacts.values()).toHaveLength(0);
  });

  it("requires at least one identity", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const error = errorOf(await new UpsertContact(kit.deps).execute({ tenantId: T1, phone: "  " }));
    expect((error as ValidationError).fields).toEqual([
      { field: "phone", message: "identity_required" },
    ]);
  });

  it("reports CONTACT_IDENTITY_CONFLICT when the phone and the email belong to two contacts", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const uc = new UpsertContact(kit.deps);
    okValue(await uc.execute({ tenantId: T1, phone: "01012345678" }));
    okValue(await uc.execute({ tenantId: T1, email: "b@b.test" }));
    const error = errorOf(
      await uc.execute({ tenantId: T1, phone: "01012345678", email: "b@b.test" }),
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("CONTACT_IDENTITY_CONFLICT");
  });

  it("a concurrent create of the same phone rereads the winner (one contact)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const uc = new UpsertContact(kit.deps);
    const [a, b] = await Promise.all([
      uc.execute({ tenantId: T1, phone: "01012345678" }),
      uc.execute({ tenantId: T1, phone: "01012345678" }),
    ]);
    expect(okValue(a).id).toBe(okValue(b).id);
    expect(kit.mem.store.contacts.values()).toHaveLength(1);
  });

  it("keeps tenants apart", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const uc = new UpsertContact(kit.deps);
    const a = okValue(await uc.execute({ tenantId: T1, phone: "01012345678" }));
    const b = okValue(await uc.execute({ tenantId: T2, phone: "01012345678" }));
    expect(a.id).not.toBe(b.id);
  });
});

describe("RecordConsent", () => {
  async function contact(kit: ReturnType<typeof createOutreachKit>, tenantId = T1) {
    return okValue(await new UpsertContact(kit.deps).execute({ tenantId, phone: "01012345678" }));
  }

  it("appends the event, applies the state and emits once per changed purpose", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const c = await contact(kit);
    const dto = okValue(
      await new RecordConsent(kit.deps).execute({
        tenantId: T1,
        contactId: c.id,
        channel: "whatsapp",
        purpose: "marketing",
        action: "grant",
        source: "admin",
        evidence: "  opted in at the till ",
      }),
    );
    expect(dto.whatsappMarketing).toBe("granted");
    const events = await kit.deps.contacts.listConsentEvents(T1, c.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.evidence).toBe("opted in at the till");
    expect(kit.events.ofType("outreach.contact.consent_changed")).toHaveLength(1);
    expect(kit.events.calls[0]?.payload).toEqual({
      contactId: c.id,
      channel: "whatsapp",
      purpose: "marketing",
      action: "grant",
      source: "admin",
    });
  });

  it("a no-op consent appends the audit event but emits nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const c = await contact(kit);
    const uc = new RecordConsent(kit.deps);
    const input = {
      tenantId: T1,
      contactId: c.id,
      channel: "whatsapp" as const,
      purpose: "marketing" as const,
      action: "grant" as const,
      source: "admin" as const,
    };
    okValue(await uc.execute(input));
    okValue(await uc.execute(input));
    expect(kit.events.calls).toHaveLength(1);
    expect(await kit.deps.contacts.listConsentEvents(T1, c.id)).toHaveLength(2);
  });

  it("an inbound STOP keyword revokes both WhatsApp purposes with two events", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const c = await contact(kit);
    const uc = new RecordConsent(kit.deps);
    for (const purpose of ["marketing", "transactional"] as const) {
      okValue(
        await uc.execute({
          tenantId: T1,
          contactId: c.id,
          channel: "whatsapp",
          purpose,
          action: "grant",
          source: "admin",
        }),
      );
    }
    kit.events.calls.length = 0;
    const dto = okValue(
      await uc.execute({
        tenantId: T1,
        contactId: c.id,
        channel: "whatsapp",
        purpose: "marketing",
        action: "revoke",
        source: "inbound_keyword",
      }),
    );
    expect(dto.whatsappMarketing).toBe("revoked");
    expect(dto.whatsappTransactional).toBe("revoked");
    expect(kit.events.ofType("outreach.contact.consent_changed")).toHaveLength(2);
  });

  it("another tenant's contact is NotFound and nothing is written", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const c = await contact(kit, T2);
    const error = errorOf(
      await new RecordConsent(kit.deps).execute({
        tenantId: T1,
        contactId: c.id,
        channel: "whatsapp",
        purpose: "marketing",
        action: "grant",
        source: "admin",
      }),
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect(kit.mem.store.consentEvents.values()).toHaveLength(0);
  });

  it("a rolled-back transaction leaves no event in the recorder", async () => {
    expect.hasAssertions();
    const recorder = new InMemoryOutreachEventRecorder();
    const kit = createOutreachKit();
    await expect(
      kit.deps.unitOfWork.run(T1, async (tx) => {
        await recorder.emit(
          {
            tenantId: T1,
            type: "outreach.whatsapp.disconnected",
            eventId: "e1",
            aggregateId: "a",
            occurredAt: new Date(),
            payload: { phoneNumberId: "p", wabaId: "w" },
          },
          tx,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(recorder.calls).toHaveLength(0);
  });
});
