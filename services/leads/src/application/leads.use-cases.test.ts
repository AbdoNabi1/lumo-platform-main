import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryLeadEmissionLedger } from "@platform/tracking";
import type { DomainError, ValidationError } from "@platform/utils";
import { InMemoryLeadRepository } from "../infrastructure/in-memory-lead-repository";
import { fakeShop, fixedClock, NOW, sequentialIds, validInput } from "../testing/fixtures";
import {
  ChangeLeadStatus,
  CURRENCY_CALLING_CODE,
  GetLead,
  ListLeadExportRows,
  ListLeads,
  MIN_FILL_MS,
  SubmitLead,
  type SubmitLeadInput,
} from "./leads.use-cases";
import type { ShopFactsPort } from "./ports";

beforeEach(() => {
  expect.hasAssertions();
});

function setup(shop: ShopFactsPort = fakeShop()) {
  const leads = new InMemoryLeadRepository();
  const clock = fixedClock();
  const ledger = new InMemoryLeadEmissionLedger({ now: () => clock.now().getTime() });
  const claimSpy = vi.spyOn(ledger, "claimOnce");
  const idGenerator = sequentialIds();
  const submit = new SubmitLead({ leads, ledger, shop, clock, idGenerator });
  return {
    leads,
    ledger,
    claimSpy,
    clock,
    submit,
    list: new ListLeads({ leads }),
    get: new GetLead({ leads }),
    change: new ChangeLeadStatus({ leads, clock }),
    exportRows: new ListLeadExportRows({ leads }),
  };
}

async function submitOk(s: ReturnType<typeof setup>, over: Partial<SubmitLeadInput> = {}) {
  const result = await s.submit.execute(validInput(over));
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
}

function failure(result: { ok: boolean; error?: DomainError }): DomainError {
  if (result.ok || result.error === undefined) throw new Error("expected a failure");
  return result.error;
}

function fieldsOf(error: DomainError): string[] {
  return (error as ValidationError).fields.map((f) => f.field).sort();
}

describe("constants", () => {
  it("exposes the fill-time floor and the currency calling codes", () => {
    expect(MIN_FILL_MS).toBe(3000);
    expect(CURRENCY_CALLING_CODE).toEqual({ EGP: "20", SAR: "966", AED: "971" });
  });
});

describe("SubmitLead", () => {
  it("saves a valid lead, normalises it and decides emit", async () => {
    const s = setup();
    const out = await submitOk(s);
    expect(out.emission).toBe("emit");
    expect(out.eventId).toBe(`lead_${out.leadId}`);
    const stored = await s.leads.get("t-1", out.leadId);
    expect(stored?.props).toMatchObject({
      name: "أحمد علي",
      phone: "٠١٠١٢٣٤٥٦٧٨",
      phoneE164: "+201012345678",
      email: "a@b.com",
      message: "Call me",
      status: "new",
      trackingStatus: "pending",
      eventId: `lead_${out.leadId}`,
      sessionId: "s-1",
      spamReason: null,
      formId: "home-form",
      version: 0,
    });
    expect(stored?.props.createdAt).toEqual(NOW);
    expect(stored?.props.updatedAt).toEqual(NOW);
    expect(stored?.props.attribution.cookies.fbp).toBe("fb.1.123.456");
  });

  it("stores blank email and message as null", async () => {
    const s = setup();
    const out = await submitOk(s, { email: "   ", message: "  " });
    const stored = await s.leads.get("t-1", out.leadId);
    expect(stored?.props.email).toBeNull();
    expect(stored?.props.message).toBeNull();
    const out2 = await submitOk(s, { email: undefined, message: undefined, sessionId: "s-2" });
    expect((await s.leads.get("t-1", out2.leadId))?.props.email).toBeNull();
  });

  it("suppresses the same session, then emits for a new session", async () => {
    const s = setup();
    expect((await submitOk(s)).emission).toBe("emit");
    const second = await submitOk(s);
    expect(second.emission).toBe("suppressed");
    const stored = await s.leads.get("t-1", second.leadId);
    expect(stored?.props.trackingStatus).toBe("suppressed");
    expect(stored?.props.status).toBe("new");
    expect((await submitOk(s, { sessionId: "s-2" })).emission).toBe("emit");
  });

  it("sessionAlreadyEmitted suppresses a fresh session without touching the ledger", async () => {
    const s = setup();
    const out = await submitOk(s, { sessionId: "s-fresh", sessionAlreadyEmitted: true });
    expect(out.emission).toBe("suppressed");
    expect(s.claimSpy).not.toHaveBeenCalled();
    expect((await s.leads.get("t-1", out.leadId))?.props.trackingStatus).toBe("suppressed");
  });

  it("two concurrent submits in one session give exactly one emit and one suppressed", async () => {
    const s = setup();
    const [a, b] = await Promise.all([
      submitOk(s, { sessionId: "s-9" }),
      submitOk(s, { sessionId: "s-9" }),
    ]);
    expect([a.emission, b.emission].sort()).toEqual(["emit", "suppressed"]);
  });

  it("flags a honeypot as spam, never claims, and still saves", async () => {
    const s = setup();
    const out = await submitOk(s, { spamSignals: { honeypot: true, elapsedMs: 8000 } });
    expect(out.emission).toBe("spam");
    expect(s.claimSpy).not.toHaveBeenCalled();
    const stored = await s.leads.get("t-1", out.leadId);
    expect(stored?.props).toMatchObject({
      status: "spam",
      trackingStatus: "skipped_spam",
      spamReason: "honeypot",
    });
  });

  it("flags 2999 ms as too_fast but treats 3000 ms as human", async () => {
    const s = setup();
    const fast = await submitOk(s, { spamSignals: { honeypot: false, elapsedMs: 2999 } });
    expect(fast.emission).toBe("spam");
    expect((await s.leads.get("t-1", fast.leadId))?.props.spamReason).toBe("too_fast");
    expect(s.claimSpy).not.toHaveBeenCalled();
    const ok = await submitOk(s, { spamSignals: { honeypot: false, elapsedMs: 3000 } });
    expect(ok.emission).toBe("emit");
    expect((await s.leads.get("t-1", ok.leadId))?.props.spamReason).toBeNull();
  });

  it("honeypot wins over too_fast as the recorded reason", async () => {
    const s = setup();
    const out = await submitOk(s, { spamSignals: { honeypot: true, elapsedMs: 10 } });
    expect((await s.leads.get("t-1", out.leadId))?.props.spamReason).toBe("honeypot");
  });

  it("refuses a store shop with BUSINESS_RULE and stores nothing", async () => {
    const s = setup(fakeShop({ siteType: "store" }));
    const result = await s.submit.execute(validInput());
    expect(failure(result).code).toBe("BUSINESS_RULE");
    expect(s.claimSpy).not.toHaveBeenCalled();
    expect(await s.leads.list("t-1", { first: 10 })).toHaveLength(0);
  });

  it.each([
    ["phone", { phone: "123" }],
    ["email", { email: "x@" }],
    ["name", { name: "  " }],
    ["formId", { formId: "a b" }],
  ] as const)("rejects an invalid %s with VALIDATION on that field", async (field, over) => {
    const s = setup();
    const error = failure(await s.submit.execute(validInput(over)));
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toBe("Invalid lead");
    expect(fieldsOf(error)).toEqual([field]);
    expect(await s.leads.list("t-1", { first: 10 })).toHaveLength(0);
  });

  it("reports all four invalid fields together", async () => {
    const s = setup();
    const error = failure(
      await s.submit.execute(validInput({ phone: "123", email: "x@", name: "  ", formId: "a b" })),
    );
    expect(fieldsOf(error)).toEqual(["email", "formId", "name", "phone"]);
    const phone = (error as ValidationError).fields.find((f) => f.field === "phone");
    expect(phone?.message).toBe("must be a valid phone number");
  });

  it("validates lengths, session id and elapsedMs", async () => {
    const s = setup();
    const error = failure(
      await s.submit.execute(
        validInput({
          name: "n".repeat(121),
          phone: "1".repeat(33),
          email: `${"e".repeat(320)}@b.com`,
          message: "m".repeat(2001),
          sessionId: "bad session!",
          spamSignals: { honeypot: false, elapsedMs: -1 },
          formId: "f".repeat(65),
        }),
      ),
    );
    expect(fieldsOf(error)).toEqual([
      "elapsedMs",
      "email",
      "formId",
      "message",
      "name",
      "phone",
      "sessionId",
    ]);
    const frac = failure(
      await s.submit.execute(validInput({ spamSignals: { honeypot: false, elapsedMs: 1.5 } })),
    );
    expect(fieldsOf(frac)).toEqual(["elapsedMs"]);
  });

  it("accepts boundary lengths", async () => {
    const s = setup();
    const result = await s.submit.execute(
      validInput({
        name: "n".repeat(120),
        message: "m".repeat(2000),
        formId: "f".repeat(64),
        sessionId: "a".repeat(64),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("USD with a national phone is a phone error, with + international it is ok", async () => {
    const usd = setup(fakeShop({ currency: "USD" }));
    expect(
      fieldsOf(failure(await usd.submit.execute(validInput({ phone: "01012345678" })))),
    ).toEqual(["phone"]);
    const okResult = await usd.submit.execute(validInput({ phone: "+201012345678" }));
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect((await usd.leads.get("t-1", okResult.value.leadId))?.props.phoneE164).toBe(
        "+201012345678",
      );
    }
  });

  it("uses the Saudi and Emirati calling codes", async () => {
    const sar = setup(fakeShop({ currency: "SAR" }));
    const r = await sar.submit.execute(validInput({ phone: "0501234567" }));
    expect(r.ok && (await sar.leads.get("t-1", r.value.leadId))?.props.phoneE164).toBe(
      "+966501234567",
    );
  });

  it("validates before checking the site type", async () => {
    const s = setup(fakeShop({ siteType: "store" }));
    const error = failure(await s.submit.execute(validInput({ name: " " })));
    expect(error.code).toBe("VALIDATION");
  });

  it("generates ids in ascending order so newest-first listing works", async () => {
    const s = setup();
    const a = await submitOk(s, { sessionId: "a" });
    const b = await submitOk(s, { sessionId: "b" });
    expect(a.leadId < b.leadId).toBe(true);
    expect(a.leadId).toBe("01930000-0000-7000-8000-000000000001");
  });
});

describe("ListLeads / GetLead", () => {
  async function seeded() {
    const s = setup();
    const a = await submitOk(s, { sessionId: "a" });
    const b = await submitOk(s, {
      sessionId: "b",
      spamSignals: { honeypot: true, elapsedMs: 9000 },
    });
    const c = await submitOk(s, { sessionId: "c" });
    return { s, a, b, c };
  }

  it("lists newest first and pages with the cursor", async () => {
    const { s, a, b, c } = await seeded();
    const first = await s.list.execute({ tenantId: "t-1", first: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items.map((v) => v.id)).toEqual([c.leadId, b.leadId]);
    expect(first.value.pageInfo).toEqual({ hasNextPage: true, endCursor: b.leadId });
    const rest = await s.list.execute({
      tenantId: "t-1",
      first: 2,
      after: first.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok && rest.value.items.map((v) => v.id)).toEqual([a.leadId]);
    expect(rest.ok && rest.value.pageInfo).toEqual({ hasNextPage: false, endCursor: a.leadId });
  });

  it("returns explicit view primitives, never the aggregate", async () => {
    const { s, a } = await seeded();
    const got = await s.get.execute({ tenantId: "t-1", leadId: a.leadId });
    expect(got.ok && got.value).toEqual({
      id: a.leadId,
      formId: "home-form",
      name: "أحمد علي",
      phone: "٠١٠١٢٣٤٥٦٧٨",
      phoneE164: "+201012345678",
      email: "a@b.com",
      message: "Call me",
      status: "new",
      trackingStatus: "pending",
      eventId: a.eventId,
      createdAt: "2026-11-22T10:00:00.000Z",
      pageUrl: "https://shop.example/",
      referrer: null,
    });
  });

  it("defaults the page size to 20 and caps it at 100", async () => {
    const s = setup();
    for (let i = 0; i < 25; i += 1) await submitOk(s, { sessionId: `s${i}` });
    const dflt = await s.list.execute({ tenantId: "t-1" });
    expect(dflt.ok && dflt.value.items).toHaveLength(20);
    expect(dflt.ok && dflt.value.pageInfo.hasNextPage).toBe(true);
    const spy = vi.spyOn(s.leads, "list");
    await s.list.execute({ tenantId: "t-1", first: 5000 });
    expect(spy).toHaveBeenLastCalledWith("t-1", expect.objectContaining({ first: 100 }));
    await s.list.execute({ tenantId: "t-1", first: 0 });
    expect(spy).toHaveBeenLastCalledWith("t-1", expect.objectContaining({ first: 1 }));
  });

  it("filters by status", async () => {
    const { s, b } = await seeded();
    const spam = await s.list.execute({ tenantId: "t-1", status: "spam" });
    expect(spam.ok && spam.value.items.map((v) => v.id)).toEqual([b.leadId]);
  });

  it("searches name, email and phone digits; two digits only match name/email", async () => {
    const s = setup();
    const a = await submitOk(s);
    for (const search of ["أحمد", "A@B", "1234", "  أحمد  "]) {
      const r = await s.list.execute({ tenantId: "t-1", search });
      expect(r.ok && r.value.items.map((v) => v.id)).toEqual([a.leadId]);
    }
    const twoDigits = await s.list.execute({ tenantId: "t-1", search: "12" });
    expect(twoDigits.ok && twoDigits.value.items).toHaveLength(0);
    const named = await submitOk(s, { name: "Unit 12", sessionId: "s-2" });
    const byName = await s.list.execute({ tenantId: "t-1", search: "12" });
    expect(byName.ok && byName.value.items.map((v) => v.id)).toEqual([named.leadId]);
    const blank = await s.list.execute({ tenantId: "t-1", search: "   " });
    expect(blank.ok && blank.value.items).toHaveLength(2);
  });

  it("rejects a search longer than 100 characters", async () => {
    const s = setup();
    const r = await s.list.execute({ tenantId: "t-1", search: "x".repeat(101) });
    expect(fieldsOf(failure(r))).toEqual(["search"]);
  });

  it("never shows one tenant's leads to another (list, get, status)", async () => {
    const { s, a } = await seeded();
    const list = await s.list.execute({ tenantId: "t-2" });
    expect(list.ok && list.value.items).toHaveLength(0);
    expect(failure(await s.get.execute({ tenantId: "t-2", leadId: a.leadId })).code).toBe(
      "NOT_FOUND",
    );
    expect(
      failure(await s.change.execute({ tenantId: "t-2", leadId: a.leadId, status: "contacted" }))
        .code,
    ).toBe("NOT_FOUND");
    const still = await s.get.execute({ tenantId: "t-1", leadId: a.leadId });
    expect(still.ok && still.value.status).toBe("new");
  });

  it("unknown lead id is NOT_FOUND", async () => {
    const s = setup();
    expect(failure(await s.get.execute({ tenantId: "t-1", leadId: "nope" })).code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("ChangeLeadStatus", () => {
  it("moves new to contacted at version 1, a repeat is a no-op, any status may follow any", async () => {
    const s = setup();
    const a = await submitOk(s);
    const moved = await s.change.execute({
      tenantId: "t-1",
      leadId: a.leadId,
      status: "contacted",
    });
    expect(moved.ok && moved.value.status).toBe("contacted");
    expect((await s.leads.get("t-1", a.leadId))?.props.version).toBe(1);
    const again = await s.change.execute({
      tenantId: "t-1",
      leadId: a.leadId,
      status: "contacted",
    });
    expect(again.ok && again.value.status).toBe("contacted");
    expect((await s.leads.get("t-1", a.leadId))?.props.version).toBe(1);
    const back = await s.change.execute({ tenantId: "t-1", leadId: a.leadId, status: "new" });
    expect(back.ok).toBe(true);
    expect((await s.leads.get("t-1", a.leadId))?.props.version).toBe(2);
  });

  it("rejects an unknown status with VALIDATION", async () => {
    const s = setup();
    const a = await submitOk(s);
    const r = await s.change.execute({
      tenantId: "t-1",
      leadId: a.leadId,
      status: "bogus" as never,
    });
    expect(fieldsOf(failure(r))).toEqual(["status"]);
  });

  it("answers CONCURRENCY when the optimistic update loses", async () => {
    const s = setup();
    const a = await submitOk(s);
    vi.spyOn(s.leads, "updateStatus").mockResolvedValueOnce(false);
    const r = await s.change.execute({ tenantId: "t-1", leadId: a.leadId, status: "qualified" });
    expect(failure(r).code).toBe("CONCURRENCY");
  });

  it("a stale writer loses against a fresh one", async () => {
    const s = setup();
    const a = await submitOk(s);
    const stale = await s.leads.get("t-1", a.leadId);
    await s.change.execute({ tenantId: "t-1", leadId: a.leadId, status: "contacted" });
    expect(stale).not.toBeNull();
    if (stale === null) return;
    expect(await s.leads.updateStatus("t-1", stale.withStatus("rejected", NOW))).toBe(false);
  });
});

describe("ListLeadExportRows", () => {
  it("pages 250 at a time regardless of `first`, with filters", async () => {
    const s = setup();
    const spy = vi.spyOn(s.leads, "list");
    const a = await submitOk(s);
    await submitOk(s, { sessionId: "b", spamSignals: { honeypot: true, elapsedMs: 9000 } });
    const r = await s.exportRows.execute({ tenantId: "t-1", first: 2, status: "new" });
    expect(r.ok && r.value.items.map((v) => v.id)).toEqual([a.leadId]);
    expect(spy).toHaveBeenLastCalledWith(
      "t-1",
      expect.objectContaining({ first: 250, status: "new" }),
    );
    expect(r.ok && r.value.pageInfo).toEqual({ hasNextPage: false, endCursor: a.leadId });
  });

  it("passes the date range and cursor through and stays tenant-scoped", async () => {
    const s = setup();
    await submitOk(s);
    const from = new Date("2026-11-01T00:00:00.000Z");
    const to = new Date("2026-11-30T00:00:00.000Z");
    const inRange = await s.exportRows.execute({
      tenantId: "t-1",
      createdFrom: from,
      createdTo: to,
    });
    expect(inRange.ok && inRange.value.items).toHaveLength(1);
    const outRange = await s.exportRows.execute({
      tenantId: "t-1",
      createdFrom: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(outRange.ok && outRange.value.items).toHaveLength(0);
    const other = await s.exportRows.execute({ tenantId: "t-2" });
    expect(other.ok && other.value.items).toHaveLength(0);
    const afterEnd = await s.exportRows.execute({ tenantId: "t-1", after: "ffffffff" });
    expect(afterEnd.ok && afterEnd.value.items).toHaveLength(1);
  });
});
