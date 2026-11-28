import { describe, expect, it, vi } from "vitest";
import { InMemoryLeadEmissionLedger } from "@platform/tracking";
import type { DomainError, ValidationError } from "@platform/utils";
import type { LeadRepository } from "../domain/lead-repository";
import {
  ChangeLeadStatus,
  CURRENCY_CALLING_CODE,
  GetLead,
  ListLeadExportRows,
  ListLeads,
  MIN_FILL_MS,
  SubmitLead,
  type SubmitLeadInput,
} from "../application/leads.use-cases";
import { SweepPendingLeadTracking } from "../application/lead-tracking-sweep";
import type { LeadTrackingPort, LeadTrackingSubject, ShopFactsPort } from "../application/ports";
import { fakeShop, fixedClock, leadOf, NOW, sequentialIds, validInput } from "./fixtures";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** `validInput()`/`leadOf()` phone, normalised for EGP. */
const E164_OF_VALID_INPUT = "+" + "201012345678";

/** A tracking port that records what it was asked to emit and can be told to fail the next calls. */
function recordingTracking() {
  const emitted: LeadTrackingSubject[] = [];
  let failures = 0;
  const port: LeadTrackingPort = {
    emit: (subject) => {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error("outbox unavailable"));
      }
      emitted.push(subject);
      return Promise.resolve();
    },
  };
  return {
    port,
    emitted,
    /** Emissions for one tenant (a shared test database may hold other tenants' rows). */
    emittedFor: (tenantId: string) => emitted.filter((subject) => subject.tenantId === tenantId),
    failNext: (times: number) => {
      failures = times;
    },
  };
}

/**
 * The Task 1 use-case suite, parametrised over the repository: the in-memory unit run and the
 * DATABASE_URL_TEST-gated Prisma run (`prisma-lead-repository.integration.test.ts`) execute the same
 * cases. Call it inside a `describe`; the caller owns `beforeEach(expect.hasAssertions)` and cleanup.
 */
export function describeLeadUseCases(makeRepo: () => LeadRepository): void {
  function setup(shop: ShopFactsPort = fakeShop(), tracking?: LeadTrackingPort) {
    const leads = makeRepo();
    const clock = fixedClock();
    const ledger = new InMemoryLeadEmissionLedger({ now: () => clock.now().getTime() });
    const claimSpy = vi.spyOn(ledger, "claimOnce");
    const idGenerator = sequentialIds();
    const submit = new SubmitLead({
      leads,
      ledger,
      shop,
      clock,
      idGenerator,
      ...(tracking === undefined ? {} : { tracking }),
    });
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

    it("keeps the visitor id, click ids and UTM labels on the lead (P2-D8); a lead without them reads as before", async () => {
      const s = setup();
      const withVisitor = await submitOk(s, {
        submissionKey: "visitor-key-0001",
        context: {
          ...validInput().context,
          visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
          clickIds: [{ name: "gclid", value: "abc", capturedAt: "2026-11-23T09:00:00.000Z" }],
          utm: { source: "facebook", campaign: "eid" },
        },
      });
      const stored = await s.leads.get("t-1", withVisitor.leadId);
      expect(stored?.props.attribution).toMatchObject({
        visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
        clickIds: [{ name: "gclid", value: "abc", capturedAt: "2026-11-23T09:00:00.000Z" }],
        utm: { source: "facebook", campaign: "eid" },
      });

      const plain = await submitOk(s, { submissionKey: "visitor-key-0002", sessionId: "s-9" });
      const old = await s.leads.get("t-1", plain.leadId);
      expect(old?.props.attribution).not.toHaveProperty("visitorId");
      expect(old?.props.attribution).not.toHaveProperty("clickIds");
      expect(old?.props.attribution).not.toHaveProperty("utm");
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
        await s.submit.execute(
          validInput({ phone: "123", email: "x@", name: "  ", formId: "a b" }),
        ),
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

    it("USD accepts explicit 00 international input and stores the + form", async () => {
      const usd = setup(fakeShop({ currency: "USD" }));
      const result = await usd.submit.execute(validInput({ phone: "00201012345678" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        const stored = await usd.leads.get("t-1", result.value.leadId);
        expect(stored?.props.phoneE164).toBe("+" + "201012345678");
      }
    });

    it("validates the submission key (8-128 letters, digits, hyphens)", async () => {
      const s = setup();
      for (const submissionKey of [
        "short",
        "has space 123",
        "x".repeat(129),
        "",
        "ключ-12345678",
      ]) {
        const error = failure(await s.submit.execute(validInput({ submissionKey })));
        expect(fieldsOf(error)).toEqual(["submissionKey"]);
      }
      for (const submissionKey of ["abcdefgh", "A1-b2-C3-d4", "k".repeat(128)]) {
        expect((await s.submit.execute(validInput({ submissionKey }))).ok).toBe(true);
      }
    });

    it("the same key twice saves one row, returns identical outputs and claims once", async () => {
      const s = setup();
      const first = await submitOk(s, { submissionKey: "attempt-same-key" });
      const second = await submitOk(s, { submissionKey: "attempt-same-key" });
      expect(second).toEqual(first);
      expect(first.emission).toBe("emit");
      expect(s.claimSpy).toHaveBeenCalledTimes(1);
      expect(await s.leads.list("t-1", { first: 50 })).toHaveLength(1);
    });

    it("a repeat key answers from the stored row even when the repeat looks suppressed", async () => {
      const s = setup();
      const first = await submitOk(s, { submissionKey: "attempt-repeat-1", sessionId: "s-5" });
      const repeat = await submitOk(s, {
        submissionKey: "attempt-repeat-1",
        sessionId: "s-5",
        sessionAlreadyEmitted: true,
      });
      expect(repeat).toEqual(first);
      expect(repeat.emission).toBe("emit");
    });

    it("the same key after a spam submit is spam again, still one row", async () => {
      const s = setup();
      const spam = { honeypot: true, elapsedMs: 8000 };
      const first = await submitOk(s, { submissionKey: "attempt-spam-key", spamSignals: spam });
      const second = await submitOk(s, { submissionKey: "attempt-spam-key" });
      expect(first.emission).toBe("spam");
      expect(second).toEqual(first);
      expect(await s.leads.list("t-1", { first: 50 })).toHaveLength(1);
    });

    it("two concurrent submits with one key save one row and return equal outputs", async () => {
      const s = setup();
      const [a, b] = await Promise.all([
        submitOk(s, { submissionKey: "attempt-race-key" }),
        submitOk(s, { submissionKey: "attempt-race-key" }),
      ]);
      // One row, one lead id. The `emission` of the two answers can legitimately differ: the attempt that
      // lost the session claim but reached the table first answers "suppressed" (its own decision when it
      // inserted), while the claim winner finds the duplicate, upgrades that row to pending and answers
      // "emit". Which of the two inserts first is decided by the database, so asserting `b` equals `a`
      // was a race (second submit "suppressed" instead of "emit"). What must hold: the same lead, at least
      // one "emit", and a row that ends up pending so the session's one emission is not lost.
      expect(b.leadId).toBe(a.leadId);
      expect(b.eventId).toBe(a.eventId);
      expect([a.emission, b.emission]).toContain("emit");
      expect(await s.leads.list("t-1", { first: 50 })).toHaveLength(1);
      expect((await s.leads.get("t-1", a.leadId))?.props.trackingStatus).toBe("pending");
    });

    it("a duplicate insert answers from the winning row (stale pre-check)", async () => {
      const s = setup();
      const winner = await submitOk(s, { submissionKey: "attempt-stale-key" });
      // the pre-check misses once (as a concurrent winner would), the insert then reports duplicate
      const find = vi.spyOn(s.leads, "findBySubmissionKey");
      find.mockResolvedValueOnce(null);
      const loser = await submitOk(s, { submissionKey: "attempt-stale-key" });
      expect(loser).toEqual(winner);
      expect(await s.leads.list("t-1", { first: 50 })).toHaveLength(1);
    });

    it("maps a stored tracking status to the emission (sent/failed -> emit, suppressed)", async () => {
      const s = setup();
      const cases = [
        ["sent", "emit"],
        ["failed", "emit"],
        ["suppressed", "suppressed"],
      ] as const;
      for (const [index, [trackingStatus, emission]] of cases.entries()) {
        const key = `attempt-map-${trackingStatus}`;
        await s.leads.insert(
          "t-1",
          leadOf({
            id: `01930000-0000-7000-8000-00000000009${String(index)}`,
            submissionKey: key,
            trackingStatus,
          }),
        );
        const out = await submitOk(s, { submissionKey: key });
        expect(out.emission).toBe(emission);
        expect(s.claimSpy).not.toHaveBeenCalled();
      }
    });

    it("the same key under another tenant is a separate lead", async () => {
      const s = setup();
      const a = await submitOk(s, { submissionKey: "attempt-tenant-k", tenantId: "t-1" });
      const b = await submitOk(s, { submissionKey: "attempt-tenant-k", tenantId: "t-2" });
      expect(b.leadId).not.toBe(a.leadId);
    });

    it("D4: a failed first insert does not burn the session; the next submit is suppressed", async () => {
      const repo = makeRepo();
      const clock = fixedClock();
      const ledger = new InMemoryLeadEmissionLedger({ now: () => clock.now().getTime() });
      const submit = new SubmitLead({
        leads: repo,
        ledger,
        shop: fakeShop(),
        clock,
        idGenerator: sequentialIds(),
      });
      vi.spyOn(repo, "insert").mockRejectedValueOnce(new Error("db down"));
      await expect(
        submit.execute(validInput({ sessionId: "s-1", submissionKey: "attempt-d4-first" })),
      ).rejects.toThrow("db down");
      const second = await submit.execute(
        validInput({ sessionId: "s-1", submissionKey: "attempt-d4-second" }),
      );
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.emission).toBe("suppressed");
        const stored = await repo.get("t-1", second.value.leadId);
        expect(stored?.props.trackingStatus).toBe("suppressed");
      }
    });

    /**
     * The deterministic same-key race: A wins the session claim and is paused before its insert, B (claim lost, so it
     * stores `suppressed`) inserts first, then A is released, finds the duplicate and upgrades B's row to pending.
     */
    async function sameKeyRace(tracking?: LeadTrackingPort) {
      const repo = makeRepo();
      // test-only barrier: pauses the first pending insert (attempt A) until released
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let paused: () => void = () => undefined;
      const pausedAtInsert = new Promise<void>((resolve) => {
        paused = resolve;
      });
      let armed = true;
      const barrier: LeadRepository = {
        insert: async (tenantId, lead) => {
          if (armed && lead.props.trackingStatus === "pending") {
            armed = false;
            paused();
            await gate;
          }
          return repo.insert(tenantId, lead);
        },
        findBySubmissionKey: (tenantId, key) => repo.findBySubmissionKey(tenantId, key),
        get: (tenantId, id) => repo.get(tenantId, id),
        updateStatus: (tenantId, lead) => repo.updateStatus(tenantId, lead),
        list: (tenantId, query) => repo.list(tenantId, query),
        markPendingIfSuppressed: (tenantId, key, sessionId) =>
          repo.markPendingIfSuppressed(tenantId, key, sessionId),
        listTenantsWithPendingTracking: (before, limit) =>
          repo.listTenantsWithPendingTracking(before, limit),
        listPendingTracking: (tenantId, query) => repo.listPendingTracking(tenantId, query),
        markTracking: (tenantId, id, to, at) => repo.markTracking(tenantId, id, to, at),
      };
      const clock = fixedClock();
      const ledger = new InMemoryLeadEmissionLedger({ now: () => clock.now().getTime() });
      const claimSpy = vi.spyOn(ledger, "claimOnce");
      const submit = new SubmitLead({
        leads: barrier,
        ledger,
        shop: fakeShop(),
        clock,
        idGenerator: sequentialIds(),
        ...(tracking === undefined ? {} : { tracking }),
      });
      const input = validInput({ submissionKey: "attempt-race-pending", sessionId: "s-race" });

      const first = submit.execute(input); // A: claims emit, paused before its insert
      await pausedAtInsert;
      const second = await submit.execute(input); // B: suppressed, inserts first
      release();
      const firstResult = await first;
      return { repo, claimSpy, submit, input, firstResult, second };
    }

    it("same-key race: the attempt that won the session claim keeps the pending lead", async () => {
      const { repo, claimSpy, submit, input, firstResult, second } = await sameKeyRace();
      // The attempt that inserted first answers with its own decision; the claim winner answers "emit". This is why
      // two concurrent same-key submits do not always return equal outputs (see the concurrent test above).
      expect(second.ok && second.value.emission).toBe("suppressed");

      expect(firstResult.ok && firstResult.value.emission).toBe("emit");
      const rows = await repo.list("t-1", { first: 50 });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.props.trackingStatus).toBe("pending");
      expect(rows[0]?.props.version).toBe(1);
      const claims = await Promise.all(
        claimSpy.mock.results.map((r) => r.value as Promise<boolean>),
      );
      expect(claims.filter(Boolean)).toHaveLength(1);
      // a later repeat of the same key answers emit from the stored pending row, no new claim
      const callsBefore = claimSpy.mock.calls.length;
      const repeat = await submit.execute(input);
      expect(repeat.ok && repeat.value.emission).toBe("emit");
      expect(claimSpy.mock.calls).toHaveLength(callsBefore);
    });

    it("same-key race with tracking: the claim winner, who upgrades the loser's row, emits it exactly once", async () => {
      const tracking = recordingTracking();
      const { repo, submit, input, firstResult, second } = await sameKeyRace(tracking.port);
      expect(second.ok && second.value.emission).toBe("suppressed");
      expect(firstResult.ok && firstResult.value.emission).toBe("emit");
      const rows = await repo.list("t-1", { first: 50 });
      expect(rows).toHaveLength(1);
      // the loser stored the row as suppressed and sent nothing; the winner found the duplicate, upgraded and sent it
      expect(tracking.emitted.map((subject) => subject.leadId)).toEqual([rows[0]?.props.id]);
      expect(rows[0]?.props.trackingStatus).toBe("sent");
      // a repeat answers from the settled row and sends nothing more
      const repeat = await submit.execute(input);
      expect(repeat.ok && repeat.value.emission).toBe("emit");
      expect(tracking.emitted).toHaveLength(1);
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
      const afterEnd = await s.exportRows.execute({
        tenantId: "t-1",
        after: "ffffffff-ffff-7fff-bfff-ffffffffffff",
      });
      expect(afterEnd.ok && afterEnd.value.items).toHaveLength(1);
    });
  });

  describe("SubmitLead tracking emission (P2-D9)", () => {
    it("emits once after the insert, hands over no message, and marks the lead sent", async () => {
      const tracking = recordingTracking();
      const s = setup(fakeShop(), tracking.port);
      const out = await submitOk(s, {
        context: {
          ...validInput().context,
          visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
          utm: { source: "facebook" },
        },
      });
      expect(out.emission).toBe("emit");
      expect(tracking.emitted).toHaveLength(1);
      const [subject] = tracking.emitted;
      expect(subject).toMatchObject({
        tenantId: "t-1",
        leadId: out.leadId,
        name: "أحمد علي",
        phoneE164: E164_OF_VALID_INPUT,
        email: "a@b.com",
        sessionId: "s-1",
        submittedAt: NOW,
        attribution: {
          pageUrl: "https://shop.example/",
          cookies: { fbp: "fb.1.123.456" },
          visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
          utm: { source: "facebook" },
        },
      });
      // the free-text message is never forwarded (neither as a field nor inside any other value)
      expect(subject).not.toHaveProperty("message");
      expect(JSON.stringify(subject)).not.toContain("Call me");
      expect((await s.leads.get("t-1", out.leadId))?.props.trackingStatus).toBe("sent");
    });

    it("a publish failure never fails the submit: the visitor gets the lead and it stays pending", async () => {
      const tracking = recordingTracking();
      tracking.failNext(1);
      const s = setup(fakeShop(), tracking.port);
      const out = await submitOk(s);
      expect(out.emission).toBe("emit");
      expect(tracking.emitted).toHaveLength(0);
      const stored = await s.leads.get("t-1", out.leadId);
      expect(stored?.props.trackingStatus).toBe("pending");
      expect(stored?.props.status).toBe("new");
    });

    it("a failed mark after a successful publish leaves the lead pending (the sweeper re-sends the same event)", async () => {
      const tracking = recordingTracking();
      const s = setup(fakeShop(), tracking.port);
      vi.spyOn(s.leads, "markTracking").mockRejectedValueOnce(new Error("db blip"));
      const out = await submitOk(s);
      expect(out.emission).toBe("emit");
      expect(tracking.emitted).toHaveLength(1);
      expect((await s.leads.get("t-1", out.leadId))?.props.trackingStatus).toBe("pending");
    });

    it("spam never emits, however it is detected", async () => {
      const tracking = recordingTracking();
      const s = setup(fakeShop(), tracking.port);
      await submitOk(s, { spamSignals: { honeypot: true, elapsedMs: 8000 } });
      await submitOk(s, { spamSignals: { honeypot: false, elapsedMs: 100 }, sessionId: "s-2" });
      expect(tracking.emitted).toHaveLength(0);
      const rows = await s.leads.list("t-1", { first: 10 });
      expect(rows.map((lead) => lead.props.trackingStatus)).toEqual([
        "skipped_spam",
        "skipped_spam",
      ]);
    });

    it("a suppressed lead never emits: not the second submit of a session, not an already-emitted session", async () => {
      const tracking = recordingTracking();
      const s = setup(fakeShop(), tracking.port);
      const first = await submitOk(s);
      const second = await submitOk(s);
      const done = await submitOk(s, { sessionId: "s-8", sessionAlreadyEmitted: true });
      expect([first.emission, second.emission, done.emission]).toEqual([
        "emit",
        "suppressed",
        "suppressed",
      ]);
      expect(tracking.emitted.map((subject) => subject.leadId)).toEqual([first.leadId]);
      expect((await s.leads.get("t-1", second.leadId))?.props.trackingStatus).toBe("suppressed");
    });

    it("the same submission key twice emits once", async () => {
      const tracking = recordingTracking();
      const s = setup(fakeShop(), tracking.port);
      await submitOk(s, { submissionKey: "attempt-emit-once" });
      await submitOk(s, { submissionKey: "attempt-emit-once" });
      expect(tracking.emitted).toHaveLength(1);
    });

    it("a stale pre-check (duplicate insert) does not emit a second time", async () => {
      const tracking = recordingTracking();
      const s = setup(fakeShop(), tracking.port);
      await submitOk(s, { submissionKey: "attempt-stale-emit" });
      vi.spyOn(s.leads, "findBySubmissionKey").mockResolvedValueOnce(null);
      await submitOk(s, { submissionKey: "attempt-stale-emit" });
      expect(tracking.emitted).toHaveLength(1);
    });

    it("two concurrent submits with one key emit exactly once, and the lead ends sent", async () => {
      const tracking = recordingTracking();
      const s = setup(fakeShop(), tracking.port);
      const [a] = await Promise.all([
        submitOk(s, { submissionKey: "attempt-race-emit" }),
        submitOk(s, { submissionKey: "attempt-race-emit" }),
      ]);
      expect(tracking.emitted).toHaveLength(1);
      expect((await s.leads.get("t-1", a.leadId))?.props.trackingStatus).toBe("sent");
    });

    it("without a tracking port the lead simply stays pending (dev, tests, ingest off)", async () => {
      const s = setup();
      const out = await submitOk(s);
      expect(out.emission).toBe("emit");
      expect((await s.leads.get("t-1", out.leadId))?.props.trackingStatus).toBe("pending");
    });
  });

  describe("pending tracking in the repository (P2-D9)", () => {
    const base = NOW.getTime();
    const idOf = (n: number): string => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    const lead = (n: number, over: Parameters<typeof leadOf>[0] = {}) =>
      leadOf({
        id: idOf(n),
        submissionKey: `pending-key-${String(n).padStart(4, "0")}`,
        createdAt: new Date(base + n * MINUTE),
        updatedAt: new Date(base + n * MINUTE),
        ...over,
      });

    it("lists only pending rows created before the cutoff, oldest first, of that tenant", async () => {
      const leads = makeRepo();
      await leads.insert("t-1", lead(3));
      await leads.insert("t-1", lead(1));
      await leads.insert("t-1", lead(2, { trackingStatus: "suppressed" }));
      await leads.insert("t-1", lead(4, { trackingStatus: "sent" }));
      await leads.insert("t-1", lead(5, { trackingStatus: "skipped_spam", status: "spam" }));
      await leads.insert("t-1", lead(6));
      await leads.insert("t-2", lead(7));
      const rows = await leads.listPendingTracking("t-1", {
        createdBefore: new Date(base + 6 * MINUTE),
        limit: 10,
      });
      expect(rows.map((row) => row.props.id)).toEqual([idOf(1), idOf(3)]);
      const limited = await leads.listPendingTracking("t-1", {
        createdBefore: new Date(base + 60 * MINUTE),
        limit: 1,
      });
      expect(limited.map((row) => row.props.id)).toEqual([idOf(1)]);
      expect(
        await leads.listPendingTracking("t-3", {
          createdBefore: new Date(base + 60 * MINUTE),
          limit: 10,
        }),
      ).toEqual([]);
    });

    it("names the tenants that have something pending, without exposing the rows", async () => {
      const leads = makeRepo();
      await leads.insert("t-1", lead(1));
      await leads.insert("t-2", lead(2, { trackingStatus: "sent" }));
      const tenants = await leads.listTenantsWithPendingTracking(new Date(base + 60 * MINUTE), 200);
      expect(tenants).toContain("t-1");
      expect(tenants).not.toContain("t-2");
      const tooEarly = await leads.listTenantsWithPendingTracking(new Date(base), 200);
      expect(tooEarly).not.toContain("t-1");
    });

    it("markTracking moves a pending row of that tenant once, keeps the version, and refuses everything else", async () => {
      const leads = makeRepo();
      const at = new Date(base + 30 * MINUTE);
      await leads.insert("t-1", lead(1));
      await leads.insert("t-1", lead(2, { trackingStatus: "suppressed" }));
      expect(await leads.markTracking("t-2", idOf(1), "sent", at)).toBe(false);
      expect(await leads.markTracking("t-1", idOf(2), "sent", at)).toBe(false);
      expect(await leads.markTracking("t-1", idOf(9), "sent", at)).toBe(false);
      expect(await leads.markTracking("t-1", "not-a-uuid", "sent", at)).toBe(false);
      expect(await leads.markTracking("t-1", idOf(1), "sent", at)).toBe(true);
      expect(await leads.markTracking("t-1", idOf(1), "failed", at)).toBe(false);
      const stored = await leads.get("t-1", idOf(1));
      expect(stored?.props.trackingStatus).toBe("sent");
      expect(stored?.props.version).toBe(0);
      expect(stored?.props.updatedAt).toEqual(at);
      expect((await leads.get("t-1", idOf(2)))?.props.trackingStatus).toBe("suppressed");
      expect(await leads.get("t-2", idOf(1))).toBeNull();
    });

    it("failed is a final state too", async () => {
      const leads = makeRepo();
      await leads.insert("t-1", lead(1));
      expect(await leads.markTracking("t-1", idOf(1), "failed", new Date(base + MINUTE))).toBe(
        true,
      );
      expect((await leads.get("t-1", idOf(1)))?.props.trackingStatus).toBe("failed");
      expect(
        await leads.listPendingTracking("t-1", {
          createdBefore: new Date(base + 60 * MINUTE),
          limit: 10,
        }),
      ).toEqual([]);
    });
  });

  describe("SweepPendingLeadTracking (P2-D9)", () => {
    const base = NOW.getTime();
    const sweeperOf = (
      leads: LeadRepository,
      tracking: LeadTrackingPort,
      nowMs: number,
      over: { batchSize?: number } = {},
    ) =>
      new SweepPendingLeadTracking({
        leads,
        tracking,
        clock: { now: () => new Date(nowMs) },
        tenantLimit: 200,
        ...over,
      });
    const pendingLead = (n: number, ageMs: number, over: Parameters<typeof leadOf>[0] = {}) => {
      const createdAt = new Date(base - ageMs);
      return leadOf({
        id: `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`,
        submissionKey: `sweep-key-${String(n).padStart(4, "0")}`,
        createdAt,
        updatedAt: createdAt,
        ...over,
      });
    };

    it("a publish failure at submit time, then the sweeper sends it and marks it sent", async () => {
      const tracking = recordingTracking();
      tracking.failNext(1);
      const s = setup(fakeShop(), tracking.port);
      const out = await submitOk(s);
      expect(tracking.emitted).toHaveLength(0);

      const report = await sweeperOf(s.leads, tracking.port, NOW.getTime() + 3 * MINUTE).run();
      expect(report.sent).toBeGreaterThanOrEqual(1);
      expect(tracking.emittedFor("t-1").map((subject) => subject.leadId)).toEqual([out.leadId]);
      expect((await s.leads.get("t-1", out.leadId))?.props.trackingStatus).toBe("sent");

      // nothing is left to do: a second pass sends nothing for this tenant
      await sweeperOf(s.leads, tracking.port, NOW.getTime() + 4 * MINUTE).run();
      expect(tracking.emittedFor("t-1")).toHaveLength(1);
    });

    it("leaves a lead younger than two minutes to the request that is still emitting it", async () => {
      const leads = makeRepo();
      const tracking = recordingTracking();
      await leads.insert("t-1", pendingLead(1, 90_000));
      await sweeperOf(leads, tracking.port, base).run();
      expect(tracking.emittedFor("t-1")).toHaveLength(0);
      await sweeperOf(leads, tracking.port, base + 60_000).run();
      expect(tracking.emittedFor("t-1")).toHaveLength(1);
    });

    it("marks a lead older than seven days failed without emitting it", async () => {
      const leads = makeRepo();
      const tracking = recordingTracking();
      await leads.insert("t-1", pendingLead(1, 7 * DAY + MINUTE));
      await leads.insert("t-1", pendingLead(2, 6 * DAY));
      const report = await sweeperOf(leads, tracking.port, base).run();
      expect(report.expired).toBeGreaterThanOrEqual(1);
      expect(tracking.emittedFor("t-1").map((subject) => subject.leadId)).toEqual([
        `01930000-0000-7000-8000-${"2".padStart(12, "0")}`,
      ]);
      expect(
        (await leads.get("t-1", `01930000-0000-7000-8000-${"1".padStart(12, "0")}`))?.props
          .trackingStatus,
      ).toBe("failed");
      expect(
        (await leads.get("t-1", `01930000-0000-7000-8000-${"2".padStart(12, "0")}`))?.props
          .trackingStatus,
      ).toBe("sent");
    });

    it("never touches suppressed, spam, sent or failed rows", async () => {
      const leads = makeRepo();
      const tracking = recordingTracking();
      await leads.insert("t-1", pendingLead(1, 10 * MINUTE, { trackingStatus: "suppressed" }));
      await leads.insert(
        "t-1",
        pendingLead(2, 10 * MINUTE, { trackingStatus: "skipped_spam", status: "spam" }),
      );
      await leads.insert("t-1", pendingLead(3, 10 * MINUTE, { trackingStatus: "sent" }));
      await leads.insert("t-1", pendingLead(4, 10 * MINUTE, { trackingStatus: "failed" }));
      await sweeperOf(leads, tracking.port, base).run();
      expect(tracking.emittedFor("t-1")).toHaveLength(0);
    });

    it("sweeps every tenant under that tenant's own id, and keeps going after one lead fails", async () => {
      const leads = makeRepo();
      const tracking = recordingTracking();
      await leads.insert("t-1", pendingLead(1, 10 * MINUTE));
      await leads.insert("t-2", pendingLead(2, 10 * MINUTE));
      await leads.insert("t-2", pendingLead(3, 9 * MINUTE));
      tracking.failNext(1);
      const report = await sweeperOf(leads, tracking.port, base).run();
      expect(report.errored).toBeGreaterThanOrEqual(1);
      const all = [...tracking.emittedFor("t-1"), ...tracking.emittedFor("t-2")];
      // one send failed (the first attempted); the other two went out, each under its own tenant
      expect(all).toHaveLength(2);
      for (const subject of all) {
        const stored = await leads.get(subject.tenantId, subject.leadId);
        expect(stored?.props.trackingStatus).toBe("sent");
      }
      // the one that failed is still pending for the next pass
      await sweeperOf(leads, tracking.port, base + MINUTE).run();
      expect(tracking.emittedFor("t-1")).toHaveLength(1);
      expect(tracking.emittedFor("t-2")).toHaveLength(2);
    });

    it("honours the batch size per tenant and picks up the rest next pass", async () => {
      const leads = makeRepo();
      const tracking = recordingTracking();
      for (const n of [1, 2, 3]) await leads.insert("t-1", pendingLead(n, (10 - n) * MINUTE));
      await sweeperOf(leads, tracking.port, base, { batchSize: 2 }).run();
      expect(tracking.emittedFor("t-1")).toHaveLength(2);
      await sweeperOf(leads, tracking.port, base + MINUTE, { batchSize: 2 }).run();
      expect(tracking.emittedFor("t-1")).toHaveLength(3);
    });

    it("hands the port the lead's own data and nothing else (no message)", async () => {
      const leads = makeRepo();
      const tracking = recordingTracking();
      await leads.insert("t-1", pendingLead(1, 10 * MINUTE, { message: "private words" }));
      await sweeperOf(leads, tracking.port, base).run();
      const [subject] = tracking.emittedFor("t-1");
      expect(subject).toMatchObject({
        tenantId: "t-1",
        name: "أحمد علي",
        phoneE164: E164_OF_VALID_INPUT,
      });
      expect(JSON.stringify(subject)).not.toContain("private words");
    });
  });
}
