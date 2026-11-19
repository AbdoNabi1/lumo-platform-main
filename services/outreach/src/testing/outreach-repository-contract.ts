/**
 * ONE behavioural contract for the outreach repositories. It is run against the in-memory twins on every `vitest run`
 * and against the Prisma implementations when `DATABASE_URL_TEST` is set (see `prisma-outreach.integration.test.ts`).
 * Every case uses fresh random tenant / phone / key values, so a shared database never needs cleaning.
 */
import { randomUUID } from "node:crypto";
import { ConcurrencyError } from "@platform/utils";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { describe, expect, it } from "vitest";
import type {
  ConsentEventRecord,
  ContactRecord,
  FetchedTemplate,
  InboundRecord,
  OutboundRecord,
  OutreachRepositories,
  StatusEventRecord,
  TemplateRecord,
  UnmatchedStatusRecord,
  WhatsAppConnectionRecord,
} from "../domain/repositories";

export interface MutableClock {
  now(): Date;
  set(d: Date): void;
}

export interface OutreachRepositorySet extends OutreachRepositories {
  unitOfWork: TransactionalUnitOfWork<unknown>;
}

export interface OutreachContractHarness {
  repos: OutreachRepositorySet;
  close?: () => Promise<void>;
}

export type OutreachContractFactory = (ctx: {
  clock: MutableClock;
}) => Promise<OutreachContractHarness>;

const uid = (prefix: string): string => `${prefix}-${randomUUID()}`;
const T0 = new Date("2026-11-19T10:00:00.000Z");
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

function mutableClock(): MutableClock {
  let current = T0;
  return {
    now: () => current,
    set: (d) => {
      current = d;
    },
  };
}

class Boom extends Error {}

async function rollsBack(
  uow: TransactionalUnitOfWork<unknown>,
  work: (tx: unknown) => Promise<unknown>,
) {
  await expect(
    uow.run(async (tx) => {
      await work(tx);
      throw new Boom("rollback");
    }),
  ).rejects.toBeInstanceOf(Boom);
}

function connection(
  tenantId: string,
  over: Partial<WhatsAppConnectionRecord> = {},
): WhatsAppConnectionRecord {
  return {
    tenantId,
    status: "connected",
    wabaId: uid("waba"),
    phoneNumberId: uid("phone"),
    displayPhoneNumber: "+20 100 000 0000",
    verifiedName: "Shop",
    qualityRating: null,
    messagingLimitTier: null,
    sealedCredentials: "sealed",
    connectedAt: T0,
    disconnectedAt: null,
    lastStatusSyncAt: null,
    lastError: null,
    onboardingAttemptId: null,
    onboardingStage: null,
    onboardingFailure: null,
    onboardingLeaseOwner: null,
    onboardingLeaseUntil: null,
    version: 0,
    ...over,
  };
}

function template(
  tenantId: string,
  wabaId: string,
  over: Partial<TemplateRecord> = {},
): TemplateRecord {
  return {
    id: randomUUID(),
    tenantId,
    wabaId,
    metaTemplateId: uid("meta"),
    name: uid("tpl").replaceAll("-", "_"),
    language: "en_US",
    category: "UTILITY",
    components: [{ type: "BODY", text: "Hello {{1}}" }],
    status: "APPROVED",
    rejectedReason: null,
    qualityScore: null,
    lastSyncedAt: null,
    statusEventAt: null,
    categoryEventAt: null,
    reconciledAt: null,
    revision: 1,
    version: 0,
    ...over,
  };
}

function fetched(t: TemplateRecord, over: Partial<FetchedTemplate> = {}): FetchedTemplate {
  return {
    id: randomUUID(),
    metaTemplateId: t.metaTemplateId ?? uid("meta"),
    name: t.name,
    language: t.language,
    category: t.category,
    components: t.components,
    status: t.status,
    rejectedReason: t.rejectedReason,
    qualityScore: t.qualityScore,
    ...over,
  };
}

function contact(tenantId: string, over: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: randomUUID(),
    tenantId,
    phoneE164: `+2010${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, "0")}`,
    email: null,
    customerRef: null,
    displayName: "Customer",
    whatsappMarketing: "unknown",
    whatsappTransactional: "unknown",
    emailMarketing: "unknown",
    lastInboundAt: null,
    version: 0,
    ...over,
  };
}

function outbound(tenantId: string, over: Partial<OutboundRecord> = {}): OutboundRecord {
  return {
    id: randomUUID(),
    tenantId,
    channel: "whatsapp",
    kind: "template",
    contactId: null,
    recipient: "+201000000000",
    templateName: "order_update",
    templateLanguage: "en_US",
    templateRevision: 2,
    purpose: "utility",
    payload: { components: [] },
    idempotencyKey: uid("idem"),
    status: "pending",
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    contextRef: "order:1",
    acceptedAt: null,
    correlationId: randomUUID(),
    dispatchStartedAt: T0,
    providerIdempotencyKey: null,
    dispatchPhoneNumberId: "phone-1",
    dispatchWabaId: "waba-1",
    version: 0,
    ...over,
  };
}

function statusEvent(
  tenantId: string,
  outboundMessageId: string,
  over: Partial<StatusEventRecord> = {},
): StatusEventRecord {
  return {
    id: randomUUID(),
    tenantId,
    outboundMessageId,
    providerEventId: uid("evt"),
    status: "delivered",
    occurredAt: T0,
    raw: { status: "delivered" },
    ...over,
  };
}

function inbound(
  tenantId: string,
  contactId: string,
  over: Partial<InboundRecord> = {},
): InboundRecord {
  return {
    id: randomUUID(),
    tenantId,
    contactId,
    providerMessageId: uid("wamid"),
    type: "text",
    text: "hi",
    buttonPayload: null,
    contextProviderMessageId: null,
    occurredAt: T0,
    receivedAt: at(1),
    ...over,
  };
}

function unmatched(
  tenantId: string,
  over: Partial<UnmatchedStatusRecord> = {},
): UnmatchedStatusRecord {
  return {
    id: randomUUID(),
    tenantId,
    phoneNumberId: "phone-1",
    providerEventId: uid("evt"),
    providerMessageId: uid("wamid"),
    correlationId: null,
    status: "sent",
    occurredAt: T0,
    resolvedAt: null,
    ...over,
  };
}

export function runOutreachRepositoryContract(
  name: string,
  factory: OutreachContractFactory,
): void {
  describe(`outreach repository contract: ${name}`, () => {
    const open = async (): Promise<{
      r: OutreachRepositorySet;
      clock: MutableClock;
      close: () => Promise<void>;
    }> => {
      const clock = mutableClock();
      const h = await factory({ clock });
      return { r: h.repos, clock, close: h.close ?? (() => Promise.resolve()) };
    };

    describe("WhatsAppConnectionRepository", () => {
      it("creates at version 1, updates by CAS and stores expectedVersion + 1", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        await r.connections.save(
          connection(tenant, { onboardingStage: "registering", status: "onboarding" }),
          0,
        );
        const first = await r.connections.get(tenant);
        expect(first?.version).toBe(1);
        expect(first?.status).toBe("onboarding");
        expect(first?.onboardingStage).toBe("registering");

        const lease = at(120);
        await r.connections.save(
          {
            ...first!,
            status: "connected",
            onboardingLeaseOwner: randomUUID(),
            onboardingLeaseUntil: lease,
          },
          1,
        );
        const second = await r.connections.get(tenant);
        expect(second?.version).toBe(2);
        expect(second?.status).toBe("connected");
        expect(second?.onboardingLeaseUntil).toEqual(lease);
        await close();
      });

      it("CAS miss throws ConcurrencyError (stale version, create over an existing row)", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        await r.connections.save(connection(tenant), 0);
        const row = (await r.connections.get(tenant))!;
        await r.connections.save({ ...row, lastError: "x" }, 1);
        await expect(r.connections.save({ ...row, lastError: "y" }, 1)).rejects.toBeInstanceOf(
          ConcurrencyError,
        );
        await expect(r.connections.save(connection(tenant), 0)).rejects.toBeInstanceOf(
          ConcurrencyError,
        );
        expect((await r.connections.get(tenant))?.lastError).toBe("x");
        await close();
      });

      it("never lets tenant B read or CAS tenant A's row", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const a = uid("t");
        const b = uid("t");
        await r.connections.save(connection(a), 0);
        expect(await r.connections.get(b)).toBeNull();
        await expect(r.connections.save(connection(b), 1)).rejects.toBeInstanceOf(ConcurrencyError);
        expect((await r.connections.get(a))?.version).toBe(1);
        await close();
      });

      it("a rolled-back save leaves nothing", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        await rollsBack(r.unitOfWork, (tx) => r.connections.save(connection(tenant), 0, tx));
        expect(await r.connections.get(tenant)).toBeNull();
        await close();
      });
    });

    describe("PhoneDirectory", () => {
      it("claims a free phone + WABA for a shop and finds it three ways", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [shop, phone, waba] = [uid("shop"), uid("phone"), uid("waba")];
        expect(await r.unitOfWork.run((tx) => r.directory.claim(phone, waba, shop, tx))).toBe(
          "claimed",
        );
        expect(await r.directory.find(phone)).toEqual({ shopTenantId: shop, wabaId: waba });
        expect(await r.directory.findByWaba(waba)).toEqual({
          shopTenantId: shop,
          phoneNumberId: phone,
        });
        expect(await r.directory.findByShop(shop)).toEqual({ phoneNumberId: phone, wabaId: waba });
        expect(await r.directory.find(uid("phone"))).toBeNull();
        await close();
      });

      it("is idempotent for the same shop and tuple", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [shop, phone, waba] = [uid("shop"), uid("phone"), uid("waba")];
        await r.unitOfWork.run((tx) => r.directory.claim(phone, waba, shop, tx));
        expect(await r.unitOfWork.run((tx) => r.directory.claim(phone, waba, shop, tx))).toBe(
          "claimed",
        );
        expect(await r.directory.findByShop(shop)).toEqual({ phoneNumberId: phone, wabaId: waba });
        await close();
      });

      it("two shops claiming one phone: exactly one claimed", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const phone = uid("phone");
        const shops = [uid("shop"), uid("shop")] as const;
        const results = await Promise.all(
          shops.map((shop) =>
            r.unitOfWork.run((tx) => r.directory.claim(phone, uid("waba"), shop, tx)),
          ),
        );
        expect(results.filter((x) => x === "claimed")).toHaveLength(1);
        expect(results.filter((x) => x === "phone_in_use")).toHaveLength(1);
        const owner = await r.directory.find(phone);
        expect(shops).toContain(owner?.shopTenantId);
        await close();
      });

      it("two shops claiming one WABA with different phones: exactly one claimed, the other waba_in_use", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const waba = uid("waba");
        const results = await Promise.all(
          [uid("shop"), uid("shop")].map((shop) =>
            r.unitOfWork.run((tx) => r.directory.claim(uid("phone"), waba, shop, tx)),
          ),
        );
        expect(results.filter((x) => x === "claimed")).toHaveLength(1);
        expect(results.filter((x) => x === "waba_in_use")).toHaveLength(1);
        await close();
      });

      it("a same-phone row with a different WABA owned by another shop is never claimed and never modified", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [owner, other, phone, w1, w2] = [
          uid("shop"),
          uid("shop"),
          uid("phone"),
          uid("waba"),
          uid("waba"),
        ];
        await r.unitOfWork.run((tx) => r.directory.claim(phone, w1, owner, tx));
        expect(await r.unitOfWork.run((tx) => r.directory.claim(phone, w2, other, tx))).toBe(
          "phone_in_use",
        );
        expect(await r.directory.find(phone)).toEqual({ shopTenantId: owner, wabaId: w1 });
        expect(await r.directory.findByShop(other)).toBeNull();
        await close();
      });

      it("the same shop switching WABA on the same phone releases its own tuple first, then claims", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [shop, phone, w1, w2] = [uid("shop"), uid("phone"), uid("waba"), uid("waba")];
        await r.unitOfWork.run((tx) => r.directory.claim(phone, w1, shop, tx));
        expect(await r.unitOfWork.run((tx) => r.directory.claim(phone, w2, shop, tx))).toBe(
          "claimed",
        );
        expect(await r.directory.find(phone)).toEqual({ shopTenantId: shop, wabaId: w2 });
        expect(await r.directory.findByWaba(w1)).toBeNull();
        await close();
      });

      it("reconnect to a new phone releases the old mapping", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [shop, p1, w1, p2, w2] = [
          uid("shop"),
          uid("phone"),
          uid("waba"),
          uid("phone"),
          uid("waba"),
        ];
        await r.unitOfWork.run((tx) => r.directory.claim(p1, w1, shop, tx));
        expect(await r.unitOfWork.run((tx) => r.directory.claim(p2, w2, shop, tx))).toBe("claimed");
        expect(await r.directory.find(p1)).toBeNull();
        expect(await r.directory.findByWaba(w1)).toBeNull();
        expect(await r.directory.findByShop(shop)).toEqual({ phoneNumberId: p2, wabaId: w2 });
        await close();
      });

      it("a failed claim rolled back by the caller restores the released mapping", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [shop, rival, p1, w1, p2] = [
          uid("shop"),
          uid("shop"),
          uid("phone"),
          uid("waba"),
          uid("phone"),
        ];
        await r.unitOfWork.run((tx) => r.directory.claim(p1, w1, shop, tx));
        await r.unitOfWork.run((tx) => r.directory.claim(p2, uid("waba"), rival, tx));

        let result = "";
        await expect(
          r.unitOfWork.run(async (tx) => {
            result = await r.directory.claim(p2, uid("waba"), shop, tx);
            if (result !== "claimed") throw new Boom("not claimed, roll back");
          }),
        ).rejects.toBeInstanceOf(Boom);
        expect(result).toBe("phone_in_use");
        expect(await r.directory.findByShop(shop)).toEqual({ phoneNumberId: p1, wabaId: w1 });
        expect(await r.directory.find(p2)).toMatchObject({ shopTenantId: rival });
        await close();
      });

      it("release only removes the row owned by that shop", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [shop, other, phone, waba] = [uid("shop"), uid("shop"), uid("phone"), uid("waba")];
        await r.unitOfWork.run((tx) => r.directory.claim(phone, waba, shop, tx));
        await r.unitOfWork.run((tx) => r.directory.release(phone, other, tx));
        expect(await r.directory.find(phone)).toEqual({ shopTenantId: shop, wabaId: waba });
        await r.unitOfWork.run((tx) => r.directory.release(phone, shop, tx));
        expect(await r.directory.find(phone)).toBeNull();
        await close();
      });
    });

    describe("TemplateRepository", () => {
      it("inserts at version 1, reports a duplicate for the replay key, and scopes by tenant and WABA", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b, waba, otherWaba] = [uid("t"), uid("t"), uid("waba"), uid("waba")];
        const row = template(a, waba);
        expect(await r.templates.insert(row)).toBe("inserted");
        expect(
          await r.templates.insert({ ...row, id: randomUUID(), metaTemplateId: uid("meta") }),
        ).toBe("duplicate");
        const stored = await r.templates.findByNameLanguage(a, waba, row.name, row.language);
        expect(stored).toMatchObject({
          id: row.id,
          version: 1,
          revision: row.revision,
          status: "APPROVED",
        });
        expect((await r.templates.findByProviderId(a, waba, row.metaTemplateId!))?.id).toBe(row.id);
        expect(await r.templates.list(a, waba)).toHaveLength(1);
        expect(await r.templates.list(a, otherWaba)).toEqual([]);
        expect(await r.templates.list(b, waba)).toEqual([]);
        expect(await r.templates.findByNameLanguage(b, waba, row.name, row.language)).toBeNull();
        expect(await r.templates.findByProviderId(b, waba, row.metaTemplateId!)).toBeNull();
        await close();
      });

      it("an id collision under a different replay key propagates as an unexpected unique conflict", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba);
        await r.templates.insert(row);
        await expect(r.templates.insert({ ...template(tenant, waba), id: row.id })).rejects.toThrow(
          /unexpected unique conflict/,
        );
        await close();
      });

      it("a rolled-back insert leaves nothing", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba);
        await rollsBack(r.unitOfWork, (tx) => r.templates.insert(row, tx));
        expect(await r.templates.list(tenant, waba)).toEqual([]);
        await close();
      });

      it("status event: applied sets value + marker + revision, then noop, stale, conflict", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { status: "PENDING" });
        await r.templates.insert(row);
        const id = row.metaTemplateId!;

        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "APPROVED",
            reason: null,
            eventAt: at(10),
          }),
        ).toBe("applied");
        let s = await r.templates.findByProviderId(tenant, waba, id);
        expect(s).toMatchObject({
          status: "APPROVED",
          statusEventAt: at(10),
          revision: row.revision + 1,
          version: 2,
        });

        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "APPROVED",
            reason: null,
            eventAt: at(10),
          }),
        ).toBe("noop");
        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "REJECTED",
            reason: "x",
            eventAt: at(5),
          }),
        ).toBe("stale");
        s = await r.templates.findByProviderId(tenant, waba, id);
        expect(s).toMatchObject({ status: "APPROVED", revision: row.revision + 1 });

        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "PAUSED",
            reason: null,
            eventAt: at(10),
          }),
        ).toBe("conflict");
        s = await r.templates.findByProviderId(tenant, waba, id);
        expect(s).toMatchObject({ status: "UNKNOWN", revision: row.revision + 2 });

        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "APPROVED",
            reason: null,
            eventAt: at(20),
          }),
        ).toBe("applied");
        expect((await r.templates.findByProviderId(tenant, waba, id))?.status).toBe("APPROVED");
        await close();
      });

      it("a status event and a category event with the same time are both applied, in both orders", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const first = template(tenant, waba, { status: "PENDING", category: "UTILITY" });
        const second = template(tenant, waba, { status: "PENDING", category: "UTILITY" });
        await r.templates.insert(first);
        await r.templates.insert(second);
        const t = at(30);

        expect(
          await r.templates.applyStatusEvent(tenant, waba, first.metaTemplateId!, {
            status: "APPROVED",
            reason: null,
            eventAt: t,
          }),
        ).toBe("applied");
        expect(
          await r.templates.applyCategoryEvent(tenant, waba, first.metaTemplateId!, {
            category: "MARKETING",
            eventAt: t,
          }),
        ).toBe("applied");
        expect(
          await r.templates.applyCategoryEvent(tenant, waba, second.metaTemplateId!, {
            category: "MARKETING",
            eventAt: t,
          }),
        ).toBe("applied");
        expect(
          await r.templates.applyStatusEvent(tenant, waba, second.metaTemplateId!, {
            status: "APPROVED",
            reason: null,
            eventAt: t,
          }),
        ).toBe("applied");
        for (const row of [first, second]) {
          expect(
            await r.templates.findByProviderId(tenant, waba, row.metaTemplateId!),
          ).toMatchObject({
            status: "APPROVED",
            category: "MARKETING",
          });
        }
        await close();
      });

      it("a category event on an equal marker with a different value is a conflict (UNKNOWN)", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba);
        await r.templates.insert(row);
        const id = row.metaTemplateId!;
        await r.templates.applyCategoryEvent(tenant, waba, id, {
          category: "MARKETING",
          eventAt: at(40),
        });
        expect(
          await r.templates.applyCategoryEvent(tenant, waba, id, {
            category: "MARKETING",
            eventAt: at(40),
          }),
        ).toBe("noop");
        expect(
          await r.templates.applyCategoryEvent(tenant, waba, id, {
            category: "UTILITY",
            eventAt: at(40),
          }),
        ).toBe("conflict");
        expect((await r.templates.findByProviderId(tenant, waba, id))?.status).toBe("UNKNOWN");
        await close();
      });

      it("events are not_found for another tenant, another WABA or an unknown id", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, other, waba] = [uid("t"), uid("t"), uid("waba")];
        const row = template(tenant, waba);
        await r.templates.insert(row);
        const ev = { status: "PAUSED" as const, reason: null, eventAt: at(50) };
        expect(await r.templates.applyStatusEvent(other, waba, row.metaTemplateId!, ev)).toBe(
          "not_found",
        );
        expect(
          await r.templates.applyStatusEvent(tenant, uid("waba"), row.metaTemplateId!, ev),
        ).toBe("not_found");
        expect(await r.templates.applyStatusEvent(tenant, waba, "nope", ev)).toBe("not_found");
        expect(
          (await r.templates.findByProviderId(tenant, waba, row.metaTemplateId!))?.status,
        ).toBe("APPROVED");
        await close();
      });

      it("applyFetched applies, sets reconciledAt and increments the revision", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { status: "PENDING", revision: 3 });
        await r.templates.insert(row);
        const res = await r.templates.applyFetched(
          tenant,
          waba,
          fetched(row, { status: "APPROVED", category: "MARKETING", qualityScore: "GREEN" }),
          { revisionAtFetchStart: 3, fetchStartedAt: at(60) },
        );
        expect(res).toBe("applied");
        expect(await r.templates.findByProviderId(tenant, waba, row.metaTemplateId!)).toMatchObject(
          {
            status: "APPROVED",
            category: "MARKETING",
            qualityScore: "GREEN",
            reconciledAt: at(60),
            lastSyncedAt: at(60),
            revision: 4,
          },
        );
        await close();
      });

      it("applyFetched is raced when a write landed after the fetch started, and the event survives", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { category: "UTILITY", revision: 1 });
        await r.templates.insert(row);
        const id = row.metaTemplateId!;
        // fetch starts at 100 with revision 1; a delayed category event (entry.time 90 < fetchStartedAt) lands meanwhile
        await r.templates.applyCategoryEvent(tenant, waba, id, {
          category: "MARKETING",
          eventAt: at(90),
        });
        const res = await r.templates.applyFetched(
          tenant,
          waba,
          fetched(row, { category: "UTILITY" }),
          {
            revisionAtFetchStart: 1,
            fetchStartedAt: at(100),
          },
        );
        expect(res).toBe("raced");
        expect(await r.templates.findByProviderId(tenant, waba, id)).toMatchObject({
          category: "MARKETING",
          revision: 2,
        });
        await close();
      });

      it("applyFetched is raced for a row that no longer exists", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const ghost = template(tenant, waba);
        expect(
          await r.templates.applyFetched(tenant, waba, fetched(ghost), {
            revisionAtFetchStart: 1,
            fetchStartedAt: at(1),
          }),
        ).toBe("raced");
        await close();
      });

      it("an older fetch after a newer reconciliation is fence_newer and reconciledAt is not lowered", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { status: "PENDING", revision: 1 });
        await r.templates.insert(row);
        const id = row.metaTemplateId!;
        expect(
          await r.templates.applyFetched(tenant, waba, fetched(row, { status: "APPROVED" }), {
            revisionAtFetchStart: 1,
            fetchStartedAt: at(200),
          }),
        ).toBe("applied");
        const res = await r.templates.applyFetched(
          tenant,
          waba,
          fetched(row, { status: "PAUSED" }),
          {
            revisionAtFetchStart: 2,
            fetchStartedAt: at(150),
          },
        );
        expect(res).toBe("fence_newer");
        expect(await r.templates.findByProviderId(tenant, waba, id)).toMatchObject({
          status: "APPROVED",
          reconciledAt: at(200),
          revision: 2,
        });
        await close();
      });

      it("an event at or before reconciledAt is stale (equal second included); a later one applies", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { status: "PENDING", revision: 1 });
        await r.templates.insert(row);
        const id = row.metaTemplateId!;
        await r.templates.applyFetched(tenant, waba, fetched(row, { status: "REJECTED" }), {
          revisionAtFetchStart: 1,
          fetchStartedAt: at(300),
        });
        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "APPROVED",
            reason: null,
            eventAt: at(300),
          }),
        ).toBe("stale");
        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "APPROVED",
            reason: null,
            eventAt: at(299),
          }),
        ).toBe("stale");
        expect((await r.templates.findByProviderId(tenant, waba, id))?.status).toBe("REJECTED");
        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "APPROVED",
            reason: null,
            eventAt: at(301),
          }),
        ).toBe("applied");
        await close();
      });

      it("a delayed APPROVED after an authoritative deletion is stale", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { revision: 1 });
        await r.templates.insert(row);
        const id = row.metaTemplateId!;
        await r.templates.replaceSnapshot(tenant, waba, [], {
          revisionsAtFetchStart: new Map([[id, 1]]),
          fetchStartedAt: at(400),
        });
        expect((await r.templates.findByProviderId(tenant, waba, id))?.status).toBe("DELETED");
        expect(
          await r.templates.applyStatusEvent(tenant, waba, id, {
            status: "APPROVED",
            reason: null,
            eventAt: at(390),
          }),
        ).toBe("stale");
        expect((await r.templates.findByProviderId(tenant, waba, id))?.status).toBe("DELETED");
        await close();
      });

      it("replaceSnapshot inserts new rows, updates matches, deletes absent rows and reports status changes", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const keep = template(tenant, waba, { status: "PENDING", revision: 1 });
        const gone = template(tenant, waba, { status: "APPROVED", revision: 1 });
        await r.templates.insert(keep);
        await r.templates.insert(gone);
        const brandNew = fetched(template(tenant, waba), { status: "APPROVED" });
        const res = await r.templates.replaceSnapshot(
          tenant,
          waba,
          [fetched(keep, { status: "APPROVED" }), brandNew],
          {
            revisionsAtFetchStart: new Map([
              [keep.metaTemplateId!, 1],
              [gone.metaTemplateId!, 1],
            ]),
            fetchStartedAt: at(500),
          },
        );
        expect(res.raced).toBe(0);
        expect(res.fenceNewer).toBe(0);
        expect(res.statusChanges.map((c) => [c.name, c.from, c.to]).sort()).toEqual(
          [
            [keep.name, "PENDING", "APPROVED"],
            [brandNew.name, null, "APPROVED"],
            [gone.name, "APPROVED", "DELETED"],
          ].sort(),
        );
        const rows = await r.templates.list(tenant, waba);
        expect(rows).toHaveLength(3);
        expect(rows.find((x) => x.name === keep.name)).toMatchObject({
          status: "APPROVED",
          reconciledAt: at(500),
          revision: 2,
        });
        expect(rows.find((x) => x.name === gone.name)).toMatchObject({
          status: "DELETED",
          reconciledAt: at(500),
          revision: 2,
        });
        expect(rows.find((x) => x.name === brandNew.name)).toMatchObject({
          status: "APPROVED",
          version: 1,
        });
        await close();
      });

      it("replaceSnapshot skips raced rows (event during fetch) and does not delete a raced absent row", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const touched = template(tenant, waba, { status: "APPROVED", revision: 1 });
        const absentTouched = template(tenant, waba, { status: "APPROVED", revision: 1 });
        const absentClean = template(tenant, waba, { status: "APPROVED", revision: 1 });
        for (const row of [touched, absentTouched, absentClean]) await r.templates.insert(row);
        const revisions = new Map([
          [touched.metaTemplateId!, 1],
          [absentTouched.metaTemplateId!, 1],
          [absentClean.metaTemplateId!, 1],
        ]);
        // writes landing during the fetch
        await r.templates.applyStatusEvent(tenant, waba, touched.metaTemplateId!, {
          status: "PAUSED",
          reason: null,
          eventAt: at(590),
        });
        await r.templates.applyCategoryEvent(tenant, waba, absentTouched.metaTemplateId!, {
          category: "MARKETING",
          eventAt: at(590),
        });

        const res = await r.templates.replaceSnapshot(
          tenant,
          waba,
          [fetched(touched, { status: "APPROVED" })],
          { revisionsAtFetchStart: revisions, fetchStartedAt: at(600) },
        );
        expect(res.raced).toBe(2);
        expect(
          (await r.templates.findByProviderId(tenant, waba, touched.metaTemplateId!))?.status,
        ).toBe("PAUSED");
        expect(
          (await r.templates.findByProviderId(tenant, waba, absentTouched.metaTemplateId!))?.status,
        ).toBe("APPROVED");
        expect(
          (await r.templates.findByProviderId(tenant, waba, absentClean.metaTemplateId!))?.status,
        ).toBe("DELETED");
        await close();
      });

      it("replaceSnapshot fences a row already reconciled by a newer fetch", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { status: "PENDING", revision: 1 });
        await r.templates.insert(row);
        await r.templates.applyFetched(tenant, waba, fetched(row, { status: "APPROVED" }), {
          revisionAtFetchStart: 1,
          fetchStartedAt: at(700),
        });
        const res = await r.templates.replaceSnapshot(
          tenant,
          waba,
          [fetched(row, { status: "PAUSED" })],
          { revisionsAtFetchStart: new Map([[row.metaTemplateId!, 2]]), fetchStartedAt: at(650) },
        );
        expect(res.fenceNewer).toBe(1);
        expect(await r.templates.findByProviderId(tenant, waba, row.metaTemplateId!)).toMatchObject(
          {
            status: "APPROVED",
            reconciledAt: at(700),
          },
        );
        await close();
      });

      it("replaceSnapshot is scoped to the tenant and WABA", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b, waba, otherWaba] = [uid("t"), uid("t"), uid("waba"), uid("waba")];
        const mine = template(a, waba, { revision: 1 });
        const theirs = template(b, waba, { revision: 1 });
        const otherAssets = template(a, otherWaba, { revision: 1 });
        for (const row of [mine, theirs, otherAssets]) await r.templates.insert(row);
        await r.templates.replaceSnapshot(a, waba, [], {
          revisionsAtFetchStart: new Map([[mine.metaTemplateId!, 1]]),
          fetchStartedAt: at(800),
        });
        expect((await r.templates.list(a, waba))[0]?.status).toBe("DELETED");
        expect((await r.templates.list(b, waba))[0]?.status).toBe("APPROVED");
        expect((await r.templates.list(a, otherWaba))[0]?.status).toBe("APPROVED");
        await close();
      });

      it("markDeletedByName deletes every language of that name only", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const en = template(tenant, waba, { language: "en_US", name: "promo" });
        const ar = template(tenant, waba, { language: "ar", name: "promo" });
        const other = template(tenant, waba, { name: "other" });
        for (const row of [en, ar, other]) await r.templates.insert(row);
        await r.unitOfWork.run((tx) => r.templates.markDeletedByName(tenant, waba, "promo", tx));
        const rows = await r.templates.list(tenant, waba);
        expect(rows.filter((x) => x.name === "promo").map((x) => x.status)).toEqual([
          "DELETED",
          "DELETED",
        ]);
        expect(rows.find((x) => x.name === "other")?.status).toBe("APPROVED");
        expect(rows.find((x) => x.id === en.id)?.revision).toBe(en.revision + 1);
        await close();
      });

      it("a rolled-back event apply leaves the row unchanged", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [tenant, waba] = [uid("t"), uid("waba")];
        const row = template(tenant, waba, { status: "PENDING" });
        await r.templates.insert(row);
        await rollsBack(r.unitOfWork, (tx) =>
          r.templates.applyStatusEvent(
            tenant,
            waba,
            row.metaTemplateId!,
            { status: "APPROVED", reason: null, eventAt: at(900) },
            tx,
          ),
        );
        expect(await r.templates.findByProviderId(tenant, waba, row.metaTemplateId!)).toMatchObject(
          {
            status: "PENDING",
            statusEventAt: null,
            revision: row.revision,
          },
        );
        await close();
      });
    });

    describe("ContactRepository", () => {
      it("creates at version 1, finds by phone, email and id, and scopes by tenant", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const c = contact(a, { email: `${uid("e")}@example.com` });
        await r.contacts.save(c, 0);
        expect((await r.contacts.findByPhone(a, c.phoneE164!))?.version).toBe(1);
        expect((await r.contacts.findByEmail(a, c.email!))?.id).toBe(c.id);
        expect((await r.contacts.findById(a, c.id))?.phoneE164).toBe(c.phoneE164);
        expect(await r.contacts.findByPhone(b, c.phoneE164!)).toBeNull();
        expect(await r.contacts.findByEmail(b, c.email!)).toBeNull();
        expect(await r.contacts.findById(b, c.id)).toBeNull();
        await close();
      });

      it("the same phone can exist in two tenants", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const c = contact(a);
        await r.contacts.save(c, 0);
        await r.contacts.save(contact(b, { phoneE164: c.phoneE164 }), 0);
        expect((await r.contacts.findByPhone(b, c.phoneE164!))?.tenantId).toBe(b);
        await close();
      });

      it("CAS miss and a colliding create both throw ConcurrencyError", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const c = contact(tenant);
        await r.contacts.save(c, 0);
        const stored = (await r.contacts.findById(tenant, c.id))!;
        await r.contacts.save({ ...stored, displayName: "New" }, 1);
        await expect(r.contacts.save({ ...stored, displayName: "Lost" }, 1)).rejects.toBeInstanceOf(
          ConcurrencyError,
        );
        await expect(
          r.contacts.save(contact(tenant, { phoneE164: c.phoneE164 }), 0),
        ).rejects.toBeInstanceOf(ConcurrencyError);
        await expect(r.contacts.save({ ...c }, 0)).rejects.toBeInstanceOf(ConcurrencyError);
        expect((await r.contacts.findById(tenant, c.id))?.displayName).toBe("New");
        await close();
      });

      it("save never touches consent columns; saveConsent writes only consent", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const c = contact(tenant, {
          whatsappMarketing: "granted",
          whatsappTransactional: "allowed",
          emailMarketing: "granted",
        });
        await r.contacts.save(c, 0);
        const created = (await r.contacts.findById(tenant, c.id))!;
        expect(created).toMatchObject({
          whatsappMarketing: "unknown",
          whatsappTransactional: "unknown",
          emailMarketing: "unknown",
        });

        await r.contacts.saveConsent(
          {
            ...created,
            whatsappMarketing: "granted",
            whatsappTransactional: "allowed",
            displayName: "ignored",
          },
          1,
        );
        const consented = (await r.contacts.findById(tenant, c.id))!;
        expect(consented).toMatchObject({
          whatsappMarketing: "granted",
          whatsappTransactional: "allowed",
          emailMarketing: "unknown",
          displayName: "Customer",
          version: 2,
        });

        await r.contacts.save(
          {
            ...consented,
            displayName: "Renamed",
            lastInboundAt: at(5),
            whatsappMarketing: "revoked",
          },
          2,
        );
        const renamed = (await r.contacts.findById(tenant, c.id))!;
        expect(renamed).toMatchObject({
          displayName: "Renamed",
          lastInboundAt: at(5),
          whatsappMarketing: "granted",
          version: 3,
        });
        await expect(
          r.contacts.saveConsent({ ...renamed, emailMarketing: "revoked" }, 2),
        ).rejects.toBeInstanceOf(ConcurrencyError);
        await expect(r.contacts.saveConsent(contact(tenant), 1)).rejects.toBeInstanceOf(
          ConcurrencyError,
        );
        await close();
      });

      it("an update that would break a unique key surfaces an error and changes nothing", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const one = contact(tenant);
        const two = contact(tenant);
        await r.contacts.save(one, 0);
        await r.contacts.save(two, 0);
        const stored = (await r.contacts.findById(tenant, two.id))!;
        await expect(r.contacts.save({ ...stored, phoneE164: one.phoneE164 }, 1)).rejects.toThrow();
        expect((await r.contacts.findById(tenant, two.id))?.phoneE164).toBe(two.phoneE164);
        await close();
      });

      it("consent events are append-only per tenant and contact; a rollback leaves nothing", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const c = contact(a);
        await r.contacts.save(c, 0);
        const ev = (over: Partial<ConsentEventRecord> = {}): ConsentEventRecord => ({
          id: randomUUID(),
          tenantId: a,
          contactId: c.id,
          channel: "whatsapp",
          purpose: "marketing",
          action: "grant",
          source: "admin",
          evidence: null,
          occurredAt: at(1),
          ...over,
        });
        await r.contacts.appendConsent(ev({ occurredAt: at(2), action: "revoke" }));
        await r.contacts.appendConsent(ev({ occurredAt: at(1) }));
        const list = await r.contacts.listConsentEvents(a, c.id);
        expect(list.map((e) => e.action)).toEqual(["grant", "revoke"]);
        expect(await r.contacts.listConsentEvents(b, c.id)).toEqual([]);
        await rollsBack(r.unitOfWork, (tx) =>
          r.contacts.appendConsent(ev({ evidence: "rolled back" }), tx),
        );
        expect(await r.contacts.listConsentEvents(a, c.id)).toHaveLength(2);
        await close();
      });

      it("a rolled-back save leaves nothing", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const c = contact(tenant);
        await rollsBack(r.unitOfWork, (tx) => r.contacts.save(c, 0, tx));
        expect(await r.contacts.findById(tenant, c.id)).toBeNull();
        expect(await r.contacts.findByPhone(tenant, c.phoneE164!)).toBeNull();
        await close();
      });
    });

    describe("OutboundMessageRepository", () => {
      it("inserts, reports a duplicate for the replay key and finds the row four ways", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const row = outbound(tenant, { providerMessageId: uid("wamid") });
        expect(await r.outbound.insert(row)).toBe("inserted");
        expect(
          await r.outbound.insert({
            ...row,
            id: randomUUID(),
            correlationId: randomUUID(),
            providerMessageId: null,
          }),
        ).toBe("duplicate");
        expect(await r.outbound.findById(tenant, row.id)).toMatchObject({
          idempotencyKey: row.idempotencyKey,
          version: 1,
          status: "pending",
        });
        expect((await r.outbound.findByIdempotencyKey(tenant, row.idempotencyKey))?.id).toBe(
          row.id,
        );
        expect((await r.outbound.findByProviderId(tenant, row.providerMessageId!))?.id).toBe(
          row.id,
        );
        expect((await r.outbound.findByCorrelationId(tenant, row.correlationId))?.id).toBe(row.id);
        expect(await r.outbound.findById(tenant, randomUUID())).toBeNull();
        await close();
      });

      it("round-trips every column", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const row = outbound(tenant, {
          channel: "email",
          kind: "email",
          purpose: "transactional",
          templateName: null,
          templateLanguage: null,
          templateRevision: null,
          recipient: "buyer@example.com",
          providerIdempotencyKey: "outreach/email/x",
          dispatchPhoneNumberId: null,
          dispatchWabaId: null,
          contextRef: null,
          payload: { subject: "s", nested: { a: [1, 2] } },
        });
        await r.outbound.insert(row);
        expect(await r.outbound.findById(tenant, row.id)).toEqual({ ...row, version: 1 });
        await close();
      });

      it("is tenant isolated: the same key is free in another tenant and B cannot read A", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const row = outbound(a, { providerMessageId: uid("wamid") });
        await r.outbound.insert(row);
        expect(await r.outbound.findByIdempotencyKey(b, row.idempotencyKey)).toBeNull();
        expect(await r.outbound.findByProviderId(b, row.providerMessageId!)).toBeNull();
        expect(await r.outbound.findByCorrelationId(b, row.correlationId)).toBeNull();
        expect(await r.outbound.findById(b, row.id)).toBeNull();
        await expect(r.outbound.update({ ...row, status: "failed" }, 1)).resolves.toBeUndefined();
        await expect(
          r.outbound.update({ ...row, tenantId: b, status: "sent" }, 1),
        ).rejects.toBeInstanceOf(ConcurrencyError);
        expect((await r.outbound.findById(a, row.id))?.status).toBe("failed");
        await close();
      });

      it("update is a CAS that writes only the mutable columns", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const row = outbound(tenant);
        await r.outbound.insert(row);
        const read = (await r.outbound.findById(tenant, row.id))!;
        await r.outbound.update(
          {
            ...read,
            status: "accepted",
            providerMessageId: uid("wamid"),
            errorCode: "E1",
            errorMessage: "m",
            acceptedAt: at(3),
            recipient: "+209999999999",
            payload: { tampered: true },
            idempotencyKey: "tampered",
            correlationId: randomUUID(),
          },
          1,
        );
        const after = (await r.outbound.findById(tenant, row.id))!;
        expect(after).toMatchObject({
          status: "accepted",
          errorCode: "E1",
          errorMessage: "m",
          acceptedAt: at(3),
          version: 2,
        });
        expect(after.providerMessageId).not.toBeNull();
        expect(after).toMatchObject({
          recipient: row.recipient,
          payload: row.payload,
          idempotencyKey: row.idempotencyKey,
          correlationId: row.correlationId,
        });
        await expect(r.outbound.update({ ...after, status: "sent" }, 1)).rejects.toBeInstanceOf(
          ConcurrencyError,
        );
        await close();
      });

      it("a rollback after a dedup insert leaves nothing, and a retry stores exactly once", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const row = outbound(tenant);
        await rollsBack(r.unitOfWork, async (tx) => {
          expect(await r.outbound.insert(row, tx)).toBe("inserted");
        });
        expect(await r.outbound.findByIdempotencyKey(tenant, row.idempotencyKey)).toBeNull();
        expect(await r.unitOfWork.run((tx) => r.outbound.insert(row, tx))).toBe("inserted");
        expect(await r.unitOfWork.run((tx) => r.outbound.insert(row, tx))).toBe("duplicate");
        await close();
      });

      it("a unique conflict that is not the replay key propagates and rolls the unit of work back", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const existing = outbound(tenant);
        await r.outbound.insert(existing);
        const marker = contact(tenant);

        // UUID collision with a different idempotency key
        await expect(
          r.unitOfWork.run(async (tx) => {
            await r.contacts.save(marker, 0, tx);
            await r.outbound.insert(outbound(tenant, { id: existing.id }), tx);
          }),
        ).rejects.toThrow(/unexpected unique conflict/);
        expect(await r.contacts.findById(tenant, marker.id)).toBeNull();

        // correlation-id collision with a different idempotency key
        await expect(
          r.outbound.insert(outbound(tenant, { correlationId: existing.correlationId })),
        ).rejects.toThrow(/unexpected unique conflict/);
        await close();
      });

      it("records status events once per provider event id, and rejects other unique conflicts", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const row = outbound(a);
        await r.outbound.insert(row);
        const ev = statusEvent(a, row.id);
        expect(await r.outbound.recordStatusEvent(ev)).toBe("inserted");
        expect(await r.outbound.recordStatusEvent({ ...ev, id: randomUUID() })).toBe("duplicate");
        expect(
          await r.outbound.recordStatusEvent({
            ...statusEvent(b, row.id),
            providerEventId: ev.providerEventId,
          }),
        ).toBe("inserted");
        await expect(
          r.outbound.recordStatusEvent({ ...statusEvent(a, row.id), id: ev.id }),
        ).rejects.toThrow(/unexpected unique conflict/);
        await close();
      });

      it("a rolled-back status event can be recorded again", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const row = outbound(tenant);
        await r.outbound.insert(row);
        const ev = statusEvent(tenant, row.id);
        await rollsBack(r.unitOfWork, async (tx) => {
          expect(await r.outbound.recordStatusEvent(ev, tx)).toBe("inserted");
        });
        expect(await r.outbound.recordStatusEvent(ev)).toBe("inserted");
        await close();
      });

      it("listUnresolved is tenant-scoped, pending-only, time-bounded, oldest first and limited", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const old1 = outbound(a, { dispatchStartedAt: at(-600) });
        const old2 = outbound(a, { dispatchStartedAt: at(-500) });
        const fresh = outbound(a, { dispatchStartedAt: at(-10) });
        const settled = outbound(a, { dispatchStartedAt: at(-700), status: "sent" });
        const neverDispatched = outbound(a, { dispatchStartedAt: null });
        const theirs = outbound(b, { dispatchStartedAt: at(-600) });
        for (const row of [old2, old1, fresh, settled, neverDispatched, theirs])
          await r.outbound.insert(row);

        const listA = await r.outbound.listUnresolved(a, at(-300), 10);
        expect(listA.map((x) => x.id)).toEqual([old1.id, old2.id]);
        expect(listA.every((x) => x.tenantId === a && x.version === 1)).toBe(true);
        expect((await r.outbound.listUnresolved(b, at(-300), 10)).map((x) => x.id)).toEqual([
          theirs.id,
        ]);
        expect(await r.outbound.listUnresolved(a, at(-300), 1)).toHaveLength(1);
        await close();
      });

      it("markUnknownIfPending settles each shop's abandoned row only under its own tenant, once", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const rowA = outbound(a, { dispatchStartedAt: at(-600) });
        const rowB = outbound(b, { dispatchStartedAt: at(-600) });
        await r.outbound.insert(rowA);
        await r.outbound.insert(rowB);

        // a tenant cannot settle another tenant's row
        expect(await r.outbound.markUnknownIfPending(b, rowA.id, 1)).toBe("skipped");
        expect(await r.outbound.markUnknownIfPending(a, rowA.id, 1)).toBe("marked");
        expect(await r.outbound.markUnknownIfPending(a, rowA.id, 1)).toBe("skipped");
        expect(await r.outbound.findById(a, rowA.id)).toMatchObject({
          status: "unknown",
          version: 2,
        });
        expect((await r.outbound.findById(b, rowB.id))?.status).toBe("pending");
        expect(await r.outbound.listUnresolved(a, at(-300), 10)).toEqual([]);
        expect(await r.outbound.listUnresolved(b, at(-300), 10)).toHaveLength(1);
        expect(await r.outbound.markUnknownIfPending(b, rowB.id, 1)).toBe("marked");
        await close();
      });

      it("markUnknownIfPending skips a row a callback advanced first, and a stale version", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const advanced = outbound(tenant, { dispatchStartedAt: at(-600) });
        const raced = outbound(tenant, { dispatchStartedAt: at(-600) });
        await r.outbound.insert(advanced);
        await r.outbound.insert(raced);
        await r.outbound.update({ ...advanced, status: "delivered" }, 1);
        expect(await r.outbound.markUnknownIfPending(tenant, advanced.id, 2)).toBe("skipped");
        expect((await r.outbound.findById(tenant, advanced.id))?.status).toBe("delivered");
        expect(await r.outbound.markUnknownIfPending(tenant, raced.id, 7)).toBe("skipped");
        expect((await r.outbound.findById(tenant, raced.id))?.status).toBe("pending");
        await close();
      });
    });

    describe("InboundMessageRepository", () => {
      it("inserts once per provider message id and scopes by tenant", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const c = contact(a);
        await r.contacts.save(c, 0);
        const row = inbound(a, c.id, {
          type: "button",
          buttonPayload: "YES",
          contextProviderMessageId: uid("wamid"),
        });
        expect(await r.inbound.insert(row)).toBe("inserted");
        expect(await r.inbound.insert({ ...row, id: randomUUID() })).toBe("duplicate");
        expect(
          await r.inbound.insert({ ...inbound(b, c.id), providerMessageId: row.providerMessageId }),
        ).toBe("inserted");
        expect(await r.inbound.findByProviderMessageId(a, row.providerMessageId)).toEqual(row);
        expect(await r.inbound.findByProviderMessageId(b, uid("wamid"))).toBeNull();
        await close();
      });

      it("an id collision under a different replay key propagates", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const c = contact(tenant);
        await r.contacts.save(c, 0);
        const row = inbound(tenant, c.id);
        await r.inbound.insert(row);
        await expect(r.inbound.insert(inbound(tenant, c.id, { id: row.id }))).rejects.toThrow(
          /unexpected unique conflict/,
        );
        await close();
      });

      it("a rolled-back insert leaves nothing", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const row = inbound(tenant, randomUUID());
        await rollsBack(r.unitOfWork, (tx) => r.inbound.insert(row, tx));
        expect(await r.inbound.findByProviderMessageId(tenant, row.providerMessageId)).toBeNull();
        await close();
      });
    });

    describe("UnmatchedStatusRepository", () => {
      it("puts once per provider event id", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const row = unmatched(a);
        expect(await r.unmatched.put(row)).toBe("inserted");
        expect(await r.unmatched.put({ ...row, id: randomUUID() })).toBe("duplicate");
        expect(
          await r.unmatched.put({ ...unmatched(b), providerEventId: row.providerEventId }),
        ).toBe("inserted");
        await expect(r.unmatched.put({ ...unmatched(a), id: row.id })).rejects.toThrow(
          /unexpected unique conflict/,
        );
        await close();
      });

      it("takeFor is bound to tenant AND phone, matches by message or correlation id, and takes a row once", async () => {
        expect.hasAssertions();
        const { r, clock, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const wamid = uid("wamid");
        const corr = randomUUID();
        const mine1 = unmatched(a, {
          providerMessageId: wamid,
          occurredAt: at(2),
          status: "delivered",
        });
        const mine0 = unmatched(a, { providerMessageId: wamid, occurredAt: at(1), status: "sent" });
        const byCorrelation = unmatched(a, {
          providerMessageId: uid("wamid"),
          correlationId: corr,
        });
        const wrongPhone = unmatched(a, { providerMessageId: wamid, phoneNumberId: "phone-2" });
        const otherTenant = unmatched(b, { providerMessageId: wamid });
        const unrelated = unmatched(a);
        for (const row of [mine1, mine0, byCorrelation, wrongPhone, otherTenant, unrelated])
          await r.unmatched.put(row);

        clock.set(at(1000));
        const taken = await r.unmatched.takeFor(a, "phone-1", { providerMessageId: wamid });
        expect(taken.map((x) => x.id)).toEqual([mine0.id, mine1.id]);
        expect(taken.every((x) => x.resolvedAt !== null)).toBe(true);
        expect(await r.unmatched.takeFor(a, "phone-1", { providerMessageId: wamid })).toEqual([]);

        const viaCorrelation = await r.unmatched.takeFor(a, "phone-1", { correlationId: corr });
        expect(viaCorrelation.map((x) => x.id)).toEqual([byCorrelation.id]);

        // the other phone's and the other tenant's rows are untouched and still takeable by their owners
        expect(
          (await r.unmatched.takeFor(a, "phone-2", { providerMessageId: wamid })).map((x) => x.id),
        ).toEqual([wrongPhone.id]);
        expect(
          (await r.unmatched.takeFor(b, "phone-1", { providerMessageId: wamid })).map((x) => x.id),
        ).toEqual([otherTenant.id]);
        expect(await r.unmatched.takeFor(a, "phone-1", {})).toEqual([]);
        await close();
      });

      it("a rolled-back takeFor leaves the rows unresolved", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const wamid = uid("wamid");
        await r.unmatched.put(unmatched(tenant, { providerMessageId: wamid }));
        await rollsBack(r.unitOfWork, async (tx) => {
          expect(
            await r.unmatched.takeFor(tenant, "phone-1", { providerMessageId: wamid }, tx),
          ).toHaveLength(1);
        });
        expect(
          await r.unmatched.takeFor(tenant, "phone-1", { providerMessageId: wamid }),
        ).toHaveLength(1);
        await close();
      });
    });

    describe("EmailSendCounterRepository", () => {
      const reserve = (
        r: OutreachRepositorySet,
        tenant: string,
        now: Date,
        limits: { perHour: number; perDay: number },
      ) => r.unitOfWork.run((tx) => r.emailCounters.reserve(tenant, now, limits, tx));

      it("hour cap boundary: limit-1 reserved, limit reserved, limit+1 refused", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const limits = { perHour: 3, perDay: 100 };
        const results = [];
        for (let i = 0; i < 4; i += 1) results.push(await reserve(r, tenant, T0, limits));
        expect(results).toEqual(["reserved", "reserved", "reserved", "hour_cap"]);
        await close();
      });

      it("day cap boundary across hours, and the next UTC day starts fresh", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const limits = { perHour: 100, perDay: 3 };
        const results = [];
        for (let i = 0; i < 4; i += 1)
          results.push(await reserve(r, tenant, new Date(T0.getTime() + i * 3_600_000), limits));
        expect(results).toEqual(["reserved", "reserved", "reserved", "day_cap"]);
        expect(await reserve(r, tenant, new Date("2026-11-20T00:00:00.000Z"), limits)).toBe(
          "reserved",
        );
        await close();
      });

      it("a refusal leaves BOTH windows unchanged", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        // day = 2 after two sends in the first hour
        await reserve(r, tenant, T0, { perHour: 5, perDay: 3 });
        await reserve(r, tenant, T0, { perHour: 5, perDay: 3 });
        const nextHour = new Date(T0.getTime() + 3_600_000);
        expect(await reserve(r, tenant, nextHour, { perHour: 2, perDay: 3 })).toBe("reserved"); // day 3, hour' 1
        expect(await reserve(r, tenant, nextHour, { perHour: 2, perDay: 3 })).toBe("day_cap"); // must not bump hour' to 2
        expect(await reserve(r, tenant, nextHour, { perHour: 2, perDay: 10 })).toBe("reserved"); // hour' 2 (proves unchanged)
        expect(await reserve(r, tenant, nextHour, { perHour: 2, perDay: 10 })).toBe("hour_cap"); // must not bump day to 5
        expect(await reserve(r, tenant, nextHour, { perHour: 10, perDay: 5 })).toBe("reserved"); // day was 4 -> 5
        expect(await reserve(r, tenant, nextHour, { perHour: 10, perDay: 5 })).toBe("day_cap");
        await close();
      });

      it("is isolated per tenant", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const [a, b] = [uid("t"), uid("t")];
        const limits = { perHour: 1, perDay: 1 };
        expect(await reserve(r, a, T0, limits)).toBe("reserved");
        expect(await reserve(r, a, T0, limits)).toBe("hour_cap");
        expect(await reserve(r, b, T0, limits)).toBe("reserved");
        await close();
      });

      it("a rolled-back reservation releases its slot (cap refusal rolls back with the outbound insert)", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const limits = { perHour: 1, perDay: 1 };
        const row = outbound(tenant, { channel: "email", kind: "email" });
        await rollsBack(r.unitOfWork, async (tx) => {
          expect(await r.outbound.insert(row, tx)).toBe("inserted");
          expect(await r.emailCounters.reserve(tenant, T0, limits, tx)).toBe("reserved");
        });
        expect(await r.outbound.findByIdempotencyKey(tenant, row.idempotencyKey)).toBeNull();
        expect(await reserve(r, tenant, T0, limits)).toBe("reserved");
        await close();
      });

      it("parallel reservations at limit-1 admit exactly one", async () => {
        expect.hasAssertions();
        const { r, close } = await open();
        const tenant = uid("t");
        const limits = { perHour: 3, perDay: 100 };
        await reserve(r, tenant, T0, limits);
        await reserve(r, tenant, T0, limits);
        const results = await Promise.all([
          reserve(r, tenant, T0, limits),
          reserve(r, tenant, T0, limits),
        ]);
        expect(results.filter((x) => x === "reserved")).toHaveLength(1);
        expect(results.filter((x) => x === "hour_cap")).toHaveLength(1);
        await close();
      });
    });
  });
}
