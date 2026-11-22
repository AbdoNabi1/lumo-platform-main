import type { Database, TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import type {
  ContactRecord,
  OutboundRecord,
  TemplateRecord,
  UnmatchedStatusRecord,
  WhatsAppConnectionRecord,
} from "../domain/repositories";
import {
  connectionFromRow,
  contactFromRow,
  outboundFromRow,
  templateFromRow,
} from "./prisma-outreach-mappers";
import {
  PrismaContactRepository,
  PrismaEmailSendCounterRepository,
  PrismaInboundMessageRepository,
  PrismaOutboundMessageRepository,
  PrismaPhoneDirectory,
  PrismaUnmatchedStatusRepository,
  PrismaWhatsAppConnectionRepository,
  windowStarts,
} from "./prisma-outreach-repositories";
import { bindTenantScope } from "./prisma-outreach-unit-of-work";
import { PrismaTemplateRepository, templatePatchData } from "./prisma-template-repository";

const SHOP = "s-1";

type Args = Record<string, unknown>;
interface Call {
  model: string;
  method: string;
  args: Args;
}

const DEFAULTS: Record<string, unknown> = {
  findFirst: null,
  findMany: [],
  createMany: { count: 1 },
  updateMany: { count: 1 },
  deleteMany: { count: 1 },
};

/**
 * A transaction client that records every delegate call. `script` queues answers per `model.method`; unscripted calls
 * answer a benign default (no row / count 1).
 */
function recordingClient(script: Record<string, unknown[]> = {}, shopScope = SHOP) {
  const calls: Call[] = [];
  const execAnswers: number[] = [];
  const raw: { kind: string; sql: string; values: unknown[] }[] = [];
  const rawAnswers: unknown[][] = [];
  const tagged =
    (kind: string) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      raw.push({ kind, sql: strings.join("?").replace(/\s+/g, " ").trim(), values });
      return Promise.resolve(
        kind === "queryRaw" ? (rawAnswers.shift() ?? []) : (execAnswers.shift() ?? 0),
      );
    };
  const models = new Map<string, unknown>();
  const client = new Proxy(
    {},
    {
      get(_t, name) {
        if (name === "$executeRaw") return tagged("executeRaw");
        if (name === "$queryRaw") return tagged("queryRaw");
        if (name === "then" || typeof name !== "string") return undefined;
        if (!models.has(name)) {
          models.set(
            name,
            new Proxy(
              {},
              {
                get(_m, method) {
                  if (typeof method !== "string") return undefined;
                  return (args: Args) => {
                    calls.push({ model: name, method, args });
                    const queue = script[`${name}.${method}`];
                    const answer =
                      queue !== undefined && queue.length > 0 ? queue.shift() : DEFAULTS[method];
                    return answer instanceof Error
                      ? Promise.reject(answer)
                      : Promise.resolve(answer);
                  };
                },
              },
            ),
          );
        }
        return models.get(name);
      },
    },
  );
  // The outreach unit of work binds the shop scope to the transaction it opened; a recording client stands in for it.
  bindTenantScope(client, shopScope);
  return { tx: client as unknown as TransactionClient, calls, raw, rawAnswers, execAnswers };
}

const PLATFORM = "platform-tenant";
const NOW = new Date("2026-11-19T10:30:00.000Z");
const NOOP_PRISMA = {} as unknown as Database;
const deps = { prisma: NOOP_PRISMA };

const connectionRecord = (
  over: Partial<WhatsAppConnectionRecord> = {},
): WhatsAppConnectionRecord => ({
  tenantId: "t-1",
  status: "onboarding",
  wabaId: "waba-1",
  phoneNumberId: "phone-1",
  displayPhoneNumber: null,
  verifiedName: null,
  qualityRating: null,
  messagingLimitTier: null,
  sealedCredentials: "sealed",
  connectedAt: null,
  disconnectedAt: null,
  lastStatusSyncAt: null,
  lastError: null,
  onboardingAttemptId: "00000000-0000-4000-8000-000000000001",
  onboardingStage: "registering",
  onboardingFailure: null,
  onboardingLeaseOwner: "00000000-0000-4000-8000-000000000002",
  onboardingLeaseUntil: NOW,
  version: 9,
  ...over,
});

const contactRecord = (over: Partial<ContactRecord> = {}): ContactRecord => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  tenantId: "t-1",
  phoneE164: "+201000000001",
  email: "a@example.com",
  customerRef: null,
  displayName: "A",
  whatsappMarketing: "granted",
  whatsappTransactional: "allowed",
  emailMarketing: "revoked",
  lastInboundAt: null,
  version: 7,
  ...over,
});

const outboundRecord = (over: Partial<OutboundRecord> = {}): OutboundRecord => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  tenantId: "t-1",
  channel: "whatsapp",
  kind: "template",
  contactId: null,
  recipient: "+201000000001",
  templateName: "n",
  templateLanguage: "en_US",
  templateRevision: 3,
  purpose: "utility",
  payload: { a: 1 },
  idempotencyKey: "k-1",
  status: "accepted",
  providerMessageId: "wamid-1",
  errorCode: null,
  errorMessage: null,
  contextRef: null,
  acceptedAt: NOW,
  correlationId: "00000000-0000-4000-8000-0000000000b1",
  dispatchStartedAt: NOW,
  providerIdempotencyKey: null,
  dispatchPhoneNumberId: "phone-1",
  dispatchWabaId: "waba-1",
  version: 4,
  ...over,
});

const templateRecord = (over: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: "00000000-0000-4000-8000-0000000000d1",
  tenantId: "t-1",
  wabaId: "waba-1",
  metaTemplateId: "meta-1",
  name: "promo",
  language: "en_US",
  category: "UTILITY",
  components: [],
  status: "APPROVED",
  rejectedReason: null,
  qualityScore: null,
  lastSyncedAt: null,
  statusEventAt: null,
  categoryEventAt: null,
  reconciledAt: null,
  revision: 5,
  version: 5,
  ...over,
});

describe("PrismaWhatsAppConnectionRepository arguments", () => {
  it("reads by tenant", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    expect(await new PrismaWhatsAppConnectionRepository(deps).get("t-1", tx)).toBeNull();
    expect(calls).toEqual([
      { model: "whatsAppConnection", method: "findFirst", args: { where: { tenantId: "t-1" } } },
    ]);
  });

  it("creates at version 1 with skipDuplicates and a miss (existing row) is a ConcurrencyError", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient({ "whatsAppConnection.createMany": [{ count: 0 }] });
    await expect(
      new PrismaWhatsAppConnectionRepository(deps).save(connectionRecord({ version: 0 }), 0, tx),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    const args = calls[0]?.args as { data: Args[]; skipDuplicates: boolean };
    expect(args.skipDuplicates).toBe(true);
    expect(args.data[0]).toMatchObject({
      tenantId: "t-1",
      version: 1,
      onboardingLeaseOwner: "00000000-0000-4000-8000-000000000002",
      onboardingLeaseUntil: NOW,
      onboardingStage: "registering",
    });
  });

  it("updates only where tenant + version match and stores expectedVersion + 1", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await new PrismaWhatsAppConnectionRepository(deps).save(
      connectionRecord({ version: 9 }),
      4,
      tx,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "whatsAppConnection",
      method: "updateMany",
      args: { where: { tenantId: "t-1", version: 4 }, data: { version: 5, status: "onboarding" } },
    });
  });

  it("a CAS miss on update is a ConcurrencyError", async () => {
    expect.hasAssertions();
    const { tx } = recordingClient({ "whatsAppConnection.updateMany": [{ count: 0 }] });
    await expect(
      new PrismaWhatsAppConnectionRepository(deps).save(connectionRecord(), 4, tx),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  const ATTEMPT = "00000000-0000-4000-8000-000000000001";
  const OWNER = "00000000-0000-4000-8000-000000000002";
  const LEASE_MS = 120_000;
  const holder = {
    version: 9,
    onboardingStage: "registering" as const,
    onboardingAttemptId: ATTEMPT,
    phoneNumberId: "phone-1",
    wabaId: "waba-1",
    owner: OWNER,
  };
  const repo = new PrismaWhatsAppConnectionRepository(deps);
  const DB_NOW = /clock_timestamp\(\) AT TIME ZONE 'UTC'/;
  const lockOf = (r: { raw: { kind: string; sql: string; values: unknown[] }[] }) => r.raw[0];
  /** The row-shape predicate every lease statement carries, with the tenant first. */
  const SHAPE =
    /WHERE w\."tenant_id" = \? AND w\."version" = \? AND w\."onboarding_stage" IS NOT DISTINCT FROM \? AND w\."onboarding_attempt_id" IS NOT DISTINCT FROM \?::uuid AND w\."phone_number_id" = \? AND w\."waba_id" = \?/;
  const SHAPE_VALUES = ["t-1", 9, "registering", ATTEMPT, "phone-1", "waba-1"];

  it("every lease statement first locks the scoped row, then runs ONE raw conditional write; no delegate call", async () => {
    expect.hasAssertions();
    const acquired = recordingClient();
    acquired.execAnswers.push(1);
    await repo.acquireOnboardingLease(
      connectionRecord({ onboardingLeaseOwner: OWNER }),
      { ...holder },
      LEASE_MS,
      acquired.tx,
    );
    const renewed = recordingClient();
    renewed.execAnswers.push(1);
    await repo.renewOnboardingLease("t-1", holder, LEASE_MS, renewed.tx);
    const written = recordingClient();
    written.execAnswers.push(1);
    await repo.writeAsLeaseOwner(connectionRecord(), holder, LEASE_MS, written.tx);
    for (const run of [acquired, renewed, written]) {
      expect(run.calls).toEqual([]);
      expect(run.raw.map((x) => x.kind)).toEqual(["queryRaw", "executeRaw"]);
      const lock = lockOf(run);
      expect(lock?.sql).toMatch(
        /^SELECT "tenant_id" FROM "outreach"\."whatsapp_connections" WHERE "tenant_id" = \? FOR UPDATE$/,
      );
      expect(lock?.values).toEqual(["t-1"]);
    }
  });

  it("acquire with no expected row: an existing row loses before any insert; a missing row is created at version 1 with a database-derived deadline", async () => {
    expect.hasAssertions();
    const existing = recordingClient();
    existing.rawAnswers.push([{ tenant_id: "t-1" }]);
    await expect(
      repo.acquireOnboardingLease(
        connectionRecord({ onboardingLeaseOwner: OWNER }),
        null,
        LEASE_MS,
        existing.tx,
      ),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect(existing.raw.map((x) => x.kind)).toEqual(["queryRaw"]);

    const fresh = recordingClient();
    fresh.execAnswers.push(1);
    await repo.acquireOnboardingLease(
      connectionRecord({
        onboardingLeaseOwner: OWNER,
        onboardingLeaseUntil: new Date("2100-01-01T00:00:00.000Z"),
      }),
      null,
      LEASE_MS,
      fresh.tx,
    );
    const insert = fresh.raw[1];
    expect(insert?.sql).toMatch(/^INSERT INTO "outreach"\."whatsapp_connections" \(/);
    expect(insert?.sql).toMatch(DB_NOW);
    expect(insert?.sql).toMatch(
      /db\."now" \+ \(\?::double precision \* interval '1 millisecond'\)/,
    );
    expect(insert?.sql).toMatch(/ON CONFLICT \("tenant_id"\) DO NOTHING$/);
    expect(insert?.values).toContain("t-1");
    expect(insert?.values).toContain(OWNER);
    expect(insert?.values).toContain(LEASE_MS);
    // the caller's deadline never reaches the database; no Date is bound at all
    expect(insert?.values.some((v) => v instanceof Date)).toBe(false);
    expect(insert?.values).not.toContain("2100-01-01T00:00:00.000Z");

    const raced = recordingClient();
    raced.execAnswers.push(0);
    await expect(
      repo.acquireOnboardingLease(
        connectionRecord({ onboardingLeaseOwner: OWNER }),
        null,
        LEASE_MS,
        raced.tx,
      ),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("acquire over a row: ONE update with tenant + shape + (lease null OR expired by the database clock) at expected + 1", async () => {
    expect.hasAssertions();
    const { tx, raw, execAnswers } = recordingClient();
    execAnswers.push(1);
    await repo.acquireOnboardingLease(
      connectionRecord({ onboardingLeaseOwner: OWNER }),
      { ...holder },
      LEASE_MS,
      tx,
    );
    const update = raw[1];
    expect(update?.sql).toMatch(/^UPDATE "outreach"\."whatsapp_connections" AS w SET /);
    expect(update?.sql).toMatch(DB_NOW);
    expect(update?.sql).toMatch(SHAPE);
    expect(update?.sql).toMatch(
      /AND \(w\."onboarding_lease_until" IS NULL OR w\."onboarding_lease_until" < db\."now"\)$/,
    );
    expect(update?.sql).toMatch(/"version" = \?, "updated_at" = db\."now" FROM/);
    expect(update?.values).toEqual(expect.arrayContaining([...SHAPE_VALUES, 10, OWNER, LEASE_MS]));
    expect(update?.values.some((v) => v instanceof Date)).toBe(false);

    const missed = recordingClient();
    missed.execAnswers.push(0);
    await expect(
      repo.acquireOnboardingLease(
        connectionRecord({ onboardingLeaseOwner: OWNER }),
        { ...holder },
        LEASE_MS,
        missed.tx,
      ),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("acquire refuses to install no lease (no owner, or a length that is not positive) before any statement", async () => {
    expect.hasAssertions();
    const { tx, raw, calls } = recordingClient();
    await expect(
      repo.acquireOnboardingLease(
        connectionRecord({ onboardingLeaseOwner: null }),
        { ...holder },
        LEASE_MS,
        tx,
      ),
    ).rejects.toThrow(/install a lease/);
    for (const leaseMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        repo.acquireOnboardingLease(
          connectionRecord({ onboardingLeaseOwner: OWNER }),
          null,
          leaseMs,
          tx,
        ),
      ).rejects.toThrow(/install a lease/);
    }
    expect(raw).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("renew and owner write put lease_owner = me AND lease_until > the database clock into the update itself", async () => {
    expect.hasAssertions();
    const OWNER_PREDICATE =
      /AND w\."onboarding_lease_owner" = \?::uuid AND w\."onboarding_lease_until" > db\."now"$/;
    const renewed = recordingClient();
    renewed.execAnswers.push(1);
    await repo.renewOnboardingLease("t-1", holder, LEASE_MS, renewed.tx);
    const renew = renewed.raw[1];
    expect(renew?.sql).toMatch(DB_NOW);
    expect(renew?.sql).toMatch(SHAPE);
    expect(renew?.sql).toMatch(OWNER_PREDICATE);
    expect(renew?.sql).toMatch(
      /SET "onboarding_lease_until" = db\."now" \+ \(\?::double precision \* interval '1 millisecond'\), "version" = \?, "updated_at" = db\."now" FROM/,
    );
    expect(renew?.values).toEqual([LEASE_MS, 10, ...SHAPE_VALUES, OWNER]);

    const written = recordingClient();
    written.execAnswers.push(1);
    await repo.writeAsLeaseOwner(
      connectionRecord({ onboardingStage: "registered" }),
      holder,
      LEASE_MS,
      written.tx,
    );
    const write = written.raw[1];
    expect(write?.sql).toMatch(DB_NOW);
    expect(write?.sql).toMatch(SHAPE);
    expect(write?.sql).toMatch(OWNER_PREDICATE);
    expect(write?.values).toEqual(
      expect.arrayContaining([...SHAPE_VALUES, OWNER, 10, "registered", LEASE_MS]),
    );
    expect(write?.values.some((v) => v instanceof Date)).toBe(false);
  });

  it("a release clears both lease columns inside the same conditional write", async () => {
    expect.hasAssertions();
    const { tx, raw, execAnswers } = recordingClient();
    execAnswers.push(1);
    await repo.writeAsLeaseOwner(
      connectionRecord({ onboardingLeaseOwner: null, onboardingLeaseUntil: null }),
      holder,
      LEASE_MS,
      tx,
    );
    const write = raw[1];
    expect(write?.sql).toMatch(
      /"onboarding_lease_until" = CASE WHEN \?::uuid IS NULL THEN NULL ELSE db\."now" \+ \(\?::double precision \* interval '1 millisecond'\) END/,
    );
    // the new owner is bound as null, the holder as a predicate
    expect(write?.values).toContain(null);
    expect(write?.values).toContain(OWNER);
  });

  it("a renew or an owner write that matches no row (expired, other owner, bumped version) is a ConcurrencyError", async () => {
    expect.hasAssertions();
    const miss = () => {
      const run = recordingClient();
      run.execAnswers.push(0);
      return run.tx;
    };
    await expect(repo.renewOnboardingLease("t-1", holder, LEASE_MS, miss())).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    await expect(
      repo.writeAsLeaseOwner(connectionRecord(), holder, LEASE_MS, miss()),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe("PrismaPhoneDirectory arguments (platform scope, no exemptions)", () => {
  const directory = new PrismaPhoneDirectory({ prisma: NOOP_PRISMA, platformTenantId: PLATFORM });

  it("every finder filters the platform tenant", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await directory.find("p-1", tx);
    await directory.findByWaba("w-1", tx);
    await directory.findByShop("s-1", tx);
    expect(calls.map((c) => c.args)).toEqual([
      { where: { tenantId: PLATFORM, phoneNumberId: "p-1" } },
      { where: { tenantId: PLATFORM, wabaId: "w-1" } },
      { where: { tenantId: PLATFORM, shopTenantId: "s-1" } },
    ]);
  });

  it("inside a unit-of-work tx every directory call switches to the platform scope and restores the shop scope", async () => {
    expect.hasAssertions();
    const { tx, raw } = recordingClient();
    await directory.find("p-1", tx);
    await directory.release("p-1", "s-1", tx);
    const scopes = raw.map((x) => {
      expect(x.sql).toBe("SELECT set_config('app.tenant_id', ?, true)");
      return x.values[0];
    });
    expect(scopes).toEqual([PLATFORM, SHOP, PLATFORM, SHOP]);
  });

  it("fences take a FOR SHARE lock on the platform-scoped directory row and restore the shop scope (I10)", async () => {
    expect.hasAssertions();
    const { tx, raw, rawAnswers } = recordingClient();
    rawAnswers.push([{ shop_tenant_id: "s-1", waba_id: "w-1" }]);
    expect(await directory.fencePhone("p-1", tx)).toEqual({ shopTenantId: "s-1", wabaId: "w-1" });
    rawAnswers.push([{ shop_tenant_id: "s-1", phone_number_id: "p-1" }]);
    expect(await directory.fenceWaba("w-1", tx)).toEqual({
      shopTenantId: "s-1",
      phoneNumberId: "p-1",
    });
    const locks = raw.filter((x) => x.kind === "queryRaw");
    expect(locks).toHaveLength(2);
    for (const lock of locks) expect(lock.sql).toMatch(/FOR SHARE$/);
    expect(locks[0]?.values).toEqual([PLATFORM, "p-1"]);
    expect(locks[1]?.values).toEqual([PLATFORM, "w-1"]);
    const scopeSwitches = raw.filter((x) => x.kind === "executeRaw").map((x) => x.values[0]);
    expect(scopeSwitches).toEqual([PLATFORM, SHOP, PLATFORM, SHOP]);
  });

  it("a fence of an unowned phone or WABA is null, and a fence needs the unit-of-work tx", async () => {
    expect.hasAssertions();
    const { tx } = recordingClient();
    expect(await directory.fencePhone("p-none", tx)).toBeNull();
    expect(await directory.fenceWaba("w-none", tx)).toBeNull();
    await expect(directory.fencePhone("p-1", undefined)).rejects.toThrow(/unit-of-work/);
    await expect(directory.fenceWaba("w-1", undefined)).rejects.toThrow(/unit-of-work/);
  });

  it("restores the shop scope even when the directory call throws", async () => {
    expect.hasAssertions();
    const { tx, raw } = recordingClient({
      "whatsAppPhoneDirectory.findFirst": [new Error("boom")],
    });
    await expect(directory.find("p-1", tx)).rejects.toThrow("boom");
    expect(raw.map((x) => x.values[0])).toEqual([PLATFORM, SHOP]);
  });

  it("refuses a transaction the outreach unit of work did not open (no tenant scope)", async () => {
    expect.hasAssertions();
    const bare = { whatsAppPhoneDirectory: {} } as unknown as TransactionClient;
    await expect(directory.find("p-1", bare)).rejects.toThrow(/no tenant scope/);
  });

  it("release filters platform scope + phone + owning shop", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await directory.release("p-1", "s-1", tx);
    expect(calls).toEqual([
      {
        model: "whatsAppPhoneDirectory",
        method: "deleteMany",
        args: { where: { tenantId: PLATFORM, phoneNumberId: "p-1", shopTenantId: "s-1" } },
      },
    ]);
  });

  it("claim: release own different tuple, insert with skipDuplicates, read back by phone and by WABA", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient({
      "whatsAppPhoneDirectory.findFirst": [
        { phoneNumberId: "old-p", wabaId: "old-w", shopTenantId: "s-1", tenantId: PLATFORM },
        { phoneNumberId: "p-1", wabaId: "w-1", shopTenantId: "s-1", tenantId: PLATFORM },
        { phoneNumberId: "p-1", wabaId: "w-1", shopTenantId: "s-1", tenantId: PLATFORM },
      ],
    });
    expect(await directory.claim("p-1", "w-1", "s-1", tx)).toBe("claimed");
    expect(calls.map((c) => [c.method, c.args])).toEqual([
      ["findFirst", { where: { tenantId: PLATFORM, shopTenantId: "s-1" } }],
      [
        "deleteMany",
        { where: { tenantId: PLATFORM, phoneNumberId: "old-p", shopTenantId: "s-1" } },
      ],
      [
        "createMany",
        {
          data: [{ tenantId: PLATFORM, phoneNumberId: "p-1", shopTenantId: "s-1", wabaId: "w-1" }],
          skipDuplicates: true,
        },
      ],
      ["findFirst", { where: { tenantId: PLATFORM, phoneNumberId: "p-1" } }],
      ["findFirst", { where: { tenantId: PLATFORM, wabaId: "w-1" } }],
    ]);
  });

  it("claim never releases an identical tuple and never updates an owner", async () => {
    expect.hasAssertions();
    const same = { phoneNumberId: "p-1", wabaId: "w-1", shopTenantId: "s-1", tenantId: PLATFORM };
    const { tx, calls } = recordingClient({
      "whatsAppPhoneDirectory.findFirst": [same, same, same],
    });
    expect(await directory.claim("p-1", "w-1", "s-1", tx)).toBe("claimed");
    expect(calls.map((c) => c.method)).toEqual([
      "findFirst",
      "createMany",
      "findFirst",
      "findFirst",
    ]);
  });

  it("claim: a phone row with another WABA, or another shop, is phone_in_use", async () => {
    expect.hasAssertions();
    const otherWaba = {
      phoneNumberId: "p-1",
      wabaId: "w-OTHER",
      shopTenantId: "s-2",
      tenantId: PLATFORM,
    };
    const { tx } = recordingClient({ "whatsAppPhoneDirectory.findFirst": [null, otherWaba, null] });
    expect(await directory.claim("p-1", "w-1", "s-1", tx)).toBe("phone_in_use");
    const sameShopOtherWaba = {
      phoneNumberId: "p-1",
      wabaId: "w-OTHER",
      shopTenantId: "s-1",
      tenantId: PLATFORM,
    };
    const second = recordingClient({
      "whatsAppPhoneDirectory.findFirst": [null, sameShopOtherWaba, null],
    });
    expect(await directory.claim("p-1", "w-1", "s-1", second.tx)).toBe("phone_in_use");
  });

  it("claim: a free phone with the WABA owned by another shop is waba_in_use", async () => {
    expect.hasAssertions();
    const { tx } = recordingClient({
      "whatsAppPhoneDirectory.findFirst": [
        null,
        null,
        { phoneNumberId: "p-9", wabaId: "w-1", shopTenantId: "s-2", tenantId: PLATFORM },
      ],
    });
    expect(await directory.claim("p-1", "w-1", "s-1", tx)).toBe("waba_in_use");
  });

  it("without a tx it runs in its OWN transaction scoped to the platform tenant", async () => {
    expect.hasAssertions();
    const inner = recordingClient();
    const settings: unknown[][] = [];
    const prisma = {
      $transaction: (fn: (c: TransactionClient) => Promise<unknown>) =>
        fn(txWithSetConfig(inner.tx, settings)),
    } as unknown as Database;
    await new PrismaPhoneDirectory({ prisma, platformTenantId: PLATFORM }).find("p-1");
    expect(settings).toEqual([[PLATFORM]]);
    expect(inner.calls[0]?.args).toEqual({ where: { tenantId: PLATFORM, phoneNumberId: "p-1" } });
  });
});

describe("PrismaPhoneDirectory standalone claim", () => {
  it("a losing claim without a tx rolls its owned transaction back and still reports the public result", async () => {
    expect.hasAssertions();
    const otherShopOwnsPhone = {
      phoneNumberId: "p-2",
      wabaId: "w-2",
      shopTenantId: "s-2",
      tenantId: PLATFORM,
    };
    const inner = recordingClient({
      "whatsAppPhoneDirectory.findFirst": [
        { phoneNumberId: "p-1", wabaId: "w-1", shopTenantId: "s-1", tenantId: PLATFORM },
        otherShopOwnsPhone,
        null,
      ],
    });
    const outcomes: ("commit" | "rollback")[] = [];
    const prisma = {
      $transaction: async (fn: (c: TransactionClient) => Promise<unknown>) => {
        try {
          const result = await fn(txWithSetConfig(inner.tx, []));
          outcomes.push("commit");
          return result;
        } catch (error) {
          outcomes.push("rollback");
          throw error;
        }
      },
    } as unknown as Database;
    const directory = new PrismaPhoneDirectory({ prisma, platformTenantId: PLATFORM });
    expect(await directory.claim("p-2", "w-new", "s-1")).toBe("phone_in_use");
    // the shop's own old tuple was released inside the transaction, which therefore must not commit
    expect(inner.calls.some((c) => c.method === "deleteMany")).toBe(true);
    expect(outcomes).toEqual(["rollback"]);
  });

  it("a winning claim without a tx commits", async () => {
    expect.hasAssertions();
    const row = { phoneNumberId: "p-1", wabaId: "w-1", shopTenantId: "s-1", tenantId: PLATFORM };
    const inner = recordingClient({ "whatsAppPhoneDirectory.findFirst": [null, row, row] });
    const outcomes: string[] = [];
    const prisma = {
      $transaction: async (fn: (c: TransactionClient) => Promise<unknown>) => {
        const result = await fn(txWithSetConfig(inner.tx, []));
        outcomes.push("commit");
        return result;
      },
    } as unknown as Database;
    const directory = new PrismaPhoneDirectory({ prisma, platformTenantId: PLATFORM });
    expect(await directory.claim("p-1", "w-1", "s-1")).toBe("claimed");
    expect(outcomes).toEqual(["commit"]);
  });
});

/** Adds a `$executeRaw` that records the `set_config` tenant argument, delegating everything else. */
function txWithSetConfig(inner: TransactionClient, settings: unknown[][]): TransactionClient {
  return new Proxy(inner, {
    get(target, name, receiver) {
      if (name === "$executeRaw") {
        return (_s: TemplateStringsArray, ...values: unknown[]) => {
          settings.push(values);
          return Promise.resolve(0);
        };
      }
      return Reflect.get(target, name, receiver) as unknown;
    },
  });
}

describe("PrismaContactRepository arguments", () => {
  const repo = new PrismaContactRepository(deps);

  it("every finder names the tenant", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await repo.findByPhone("t-1", "+2010", tx);
    await repo.findByEmail("t-1", "a@b.c", tx);
    await repo.findById("t-1", "id-1", tx);
    expect(calls.map((c) => c.args)).toEqual([
      { where: { tenantId: "t-1", phoneE164: "+2010" } },
      { where: { tenantId: "t-1", email: "a@b.c" } },
      { where: { tenantId: "t-1", id: "id-1" } },
    ]);
  });

  it("save creates WITHOUT consent columns and updates WITHOUT consent columns", async () => {
    expect.hasAssertions();
    const created = recordingClient();
    await repo.save(contactRecord({ version: 0 }), 0, created.tx);
    const createArgs = created.calls[0]?.args as { data: Args[]; skipDuplicates: boolean };
    expect(createArgs.skipDuplicates).toBe(true);
    expect(Object.keys(createArgs.data[0] ?? {}).sort()).toEqual(
      [
        "customerRef",
        "displayName",
        "email",
        "id",
        "lastInboundAt",
        "phoneE164",
        "tenantId",
        "version",
      ].sort(),
    );
    expect(createArgs.data[0]).toMatchObject({ version: 1 });

    const updated = recordingClient();
    await repo.save(contactRecord(), 7, updated.tx);
    const updateArgs = updated.calls[0]?.args as { where: Args; data: Args };
    expect(updateArgs.where).toEqual({
      tenantId: "t-1",
      id: "00000000-0000-4000-8000-0000000000c1",
      version: 7,
    });
    expect(Object.keys(updateArgs.data).sort()).toEqual(
      ["customerRef", "displayName", "email", "lastInboundAt", "phoneE164", "version"].sort(),
    );
    expect(updateArgs.data["version"]).toBe(8);
  });

  it("saveConsent writes only the consent columns and the version", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await repo.saveConsent(contactRecord(), 7, tx);
    expect(calls[0]).toMatchObject({
      method: "updateMany",
      args: {
        where: { tenantId: "t-1", id: "00000000-0000-4000-8000-0000000000c1", version: 7 },
        data: {
          whatsappMarketing: "granted",
          whatsappTransactional: "allowed",
          emailMarketing: "revoked",
          version: 8,
        },
      },
    });
    expect(Object.keys((calls[0]?.args as { data: Args }).data)).toHaveLength(4);
  });

  it("clearSessionWindows is one tenant-filtered updateMany that nulls the window and bumps the version", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient({ "contact.updateMany": [{ count: 3 }] });
    expect(await repo.clearSessionWindows("t-1", tx)).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "contact",
      method: "updateMany",
      args: {
        where: { tenantId: "t-1", lastInboundAt: { not: null } },
        data: { lastInboundAt: null, version: { increment: 1 } },
      },
    });
  });

  it("a colliding create is a ConcurrencyError; a collision with nothing readable is an unexpected conflict", async () => {
    expect.hasAssertions();
    const collides = recordingClient({
      "contact.createMany": [{ count: 0 }],
      "contact.findFirst": [null, { id: "x" }, null],
    });
    await expect(repo.save(contactRecord({ version: 0 }), 0, collides.tx)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    expect(collides.calls.slice(1).map((c) => c.args)).toEqual([
      { where: { tenantId: "t-1", id: "00000000-0000-4000-8000-0000000000c1" } },
      { where: { tenantId: "t-1", phoneE164: "+201000000001" } },
      { where: { tenantId: "t-1", email: "a@example.com" } },
    ]);
    const nothing = recordingClient({ "contact.createMany": [{ count: 0 }] });
    await expect(repo.save(contactRecord({ version: 0 }), 0, nothing.tx)).rejects.toThrow(
      /unexpected unique conflict/,
    );
  });

  it("a CAS miss on update or consent is a ConcurrencyError", async () => {
    expect.hasAssertions();
    const miss = recordingClient({ "contact.updateMany": [{ count: 0 }, { count: 0 }] });
    await expect(repo.save(contactRecord(), 7, miss.tx)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(repo.saveConsent(contactRecord(), 7, miss.tx)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it("appendConsent surfaces a conflicting id; the listing is tenant + contact scoped", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient({ "consentEvent.createMany": [{ count: 0 }] });
    await expect(
      repo.appendConsent(
        {
          id: "e-1",
          tenantId: "t-1",
          contactId: "c-1",
          channel: "whatsapp",
          purpose: "marketing",
          action: "grant",
          source: "admin",
          evidence: null,
          occurredAt: NOW,
        },
        tx,
      ),
    ).rejects.toThrow(/unexpected unique conflict/);
    await repo.listConsentEvents("t-1", "c-1", tx);
    expect(calls[1]?.args).toMatchObject({ where: { tenantId: "t-1", contactId: "c-1" } });
  });

  describe("the once-only operation key", () => {
    const event = {
      id: "e-2",
      tenantId: "t-1",
      contactId: "c-1",
      channel: "whatsapp" as const,
      purpose: "transactional" as const,
      action: "grant" as const,
      source: "admin" as const,
      evidence: "test send attestation by operator-1",
      occurredAt: NOW,
    };

    it("appendConsentOnce inserts with ON CONFLICT DO NOTHING carrying the key; a lost insert is a duplicate only when the key holder is readable", async () => {
      expect.hasAssertions();
      const first = recordingClient({ "consentEvent.createMany": [{ count: 1 }] });
      expect(await repo.appendConsentOnce(event, "attest:k", first.tx)).toBe("appended");
      expect(first.calls).toHaveLength(1);
      expect(first.calls[0]?.args).toEqual({
        data: [expect.objectContaining({ id: "e-2", tenantId: "t-1", operationKey: "attest:k" })],
        skipDuplicates: true,
      });

      const repeat = recordingClient({
        "consentEvent.createMany": [{ count: 0 }],
        "consentEvent.findFirst": [{ id: "e-1" }],
      });
      expect(await repo.appendConsentOnce(event, "attest:k", repeat.tx)).toBe("duplicate");
      expect(repeat.calls[1]?.args).toEqual({
        where: { tenantId: "t-1", operationKey: "attest:k" },
      });

      const unexplained = recordingClient({ "consentEvent.createMany": [{ count: 0 }] });
      await expect(repo.appendConsentOnce(event, "attest:k", unexplained.tx)).rejects.toThrow(
        /unexpected unique conflict/,
      );
    });

    it("findConsentByOperation is tenant + key scoped and maps the stored key back", async () => {
      expect.hasAssertions();
      const { tx, calls } = recordingClient({
        "consentEvent.findFirst": [
          {
            id: "e-2",
            tenantId: "t-1",
            contactId: "c-1",
            channel: "whatsapp",
            purpose: "transactional",
            action: "grant",
            source: "admin",
            evidence: "x",
            operationKey: "attest:k",
            occurredAt: NOW,
            createdAt: NOW,
          },
          null,
        ],
      });
      expect(await repo.findConsentByOperation("t-1", "attest:k", tx)).toMatchObject({
        id: "e-2",
        operationKey: "attest:k",
      });
      expect(await repo.findConsentByOperation("t-1", "other", tx)).toBeNull();
      expect(calls.map((c) => c.args)).toEqual([
        { where: { tenantId: "t-1", operationKey: "attest:k" } },
        { where: { tenantId: "t-1", operationKey: "other" } },
      ]);
    });
  });
});

describe("PrismaOutboundMessageRepository arguments", () => {
  const repo = new PrismaOutboundMessageRepository(deps);

  it("every finder names the tenant", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await repo.findById("t-1", "id", tx);
    await repo.findByIdempotencyKey("t-1", "k", tx);
    await repo.findByProviderId("t-1", "w", tx);
    await repo.findByCorrelationId("t-1", "c", tx);
    expect(calls.map((c) => c.args)).toEqual([
      { where: { tenantId: "t-1", id: "id" } },
      { where: { tenantId: "t-1", idempotencyKey: "k" } },
      { where: { tenantId: "t-1", providerMessageId: "w" } },
      { where: { tenantId: "t-1", correlationId: "c" } },
    ]);
  });

  it("insert uses createMany + skipDuplicates, never create, and starts at version 1", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    expect(await repo.insert(outboundRecord({ version: 0 }), tx)).toBe("inserted");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("createMany");
    expect(calls[0]?.args).toMatchObject({
      skipDuplicates: true,
      data: [{ version: 1, tenantId: "t-1" }],
    });
  });

  it("count 0 + the replay key present is a duplicate; absent propagates an unexpected conflict", async () => {
    expect.hasAssertions();
    const dup = recordingClient({
      "outboundMessage.createMany": [{ count: 0 }],
      "outboundMessage.findFirst": [{}],
    });
    expect(await repo.insert(outboundRecord(), dup.tx)).toBe("duplicate");
    expect(dup.calls[1]?.args).toEqual({ where: { tenantId: "t-1", idempotencyKey: "k-1" } });

    const other = recordingClient({ "outboundMessage.createMany": [{ count: 0 }] });
    await expect(repo.insert(outboundRecord(), other.tx)).rejects.toThrow(
      /unexpected unique conflict/,
    );
  });

  it("update is a CAS on tenant + id + version that writes only the mutable columns", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await repo.update(outboundRecord({ version: 99 }), 4, tx);
    const args = calls[0]?.args as { where: Args; data: Args };
    expect(args.where).toEqual({
      tenantId: "t-1",
      id: "00000000-0000-4000-8000-0000000000a1",
      version: 4,
    });
    expect(Object.keys(args.data).sort()).toEqual(
      ["acceptedAt", "errorCode", "errorMessage", "providerMessageId", "status", "version"].sort(),
    );
    expect(args.data["version"]).toBe(5);
    const miss = recordingClient({ "outboundMessage.updateMany": [{ count: 0 }] });
    await expect(repo.update(outboundRecord(), 4, miss.tx)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it("recordStatusEvent: duplicate only for the replay key", async () => {
    expect.hasAssertions();
    const event = {
      id: "e",
      tenantId: "t-1",
      outboundMessageId: "o",
      providerEventId: "evt-1",
      status: "delivered" as const,
      occurredAt: NOW,
      raw: {},
    };
    const dup = recordingClient({
      "messageStatusEvent.createMany": [{ count: 0 }],
      "messageStatusEvent.findFirst": [{}],
    });
    expect(await repo.recordStatusEvent(event, dup.tx)).toBe("duplicate");
    expect(dup.calls[1]?.args).toEqual({ where: { tenantId: "t-1", providerEventId: "evt-1" } });
    const other = recordingClient({ "messageStatusEvent.createMany": [{ count: 0 }] });
    await expect(repo.recordStatusEvent(event, other.tx)).rejects.toThrow(
      /unexpected unique conflict/,
    );
  });

  it("listUnresolved is tenant-scoped with a pending/time filter, an order and a limit", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient({
      "outboundMessage.findMany": [[{ tenantId: "t-1", id: "o-1", version: 3 }]],
    });
    expect(await repo.listUnresolved("t-1", NOW, 25, tx)).toEqual([
      { tenantId: "t-1", id: "o-1", version: 3 },
    ]);
    expect(calls[0]?.args).toEqual({
      where: { tenantId: "t-1", status: "pending", dispatchStartedAt: { lt: NOW } },
      orderBy: [{ dispatchStartedAt: "asc" }, { id: "asc" }],
      take: 25,
      select: { tenantId: true, id: true, version: true },
    });
  });

  it("markUnknownIfPending is a CAS on tenant + id + pending + version", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    expect(await repo.markUnknownIfPending("t-1", "o-1", 2, tx)).toBe("marked");
    expect(calls[0]?.args).toEqual({
      where: { tenantId: "t-1", id: "o-1", status: "pending", version: 2 },
      data: { status: "unknown", version: 3 },
    });
    const skipped = recordingClient({ "outboundMessage.updateMany": [{ count: 0 }] });
    expect(await repo.markUnknownIfPending("t-1", "o-1", 2, skipped.tx)).toBe("skipped");
  });
});

describe("PrismaInboundMessageRepository and PrismaUnmatchedStatusRepository arguments", () => {
  it("inbound insert: createMany + skipDuplicates; duplicate only for the provider message id", async () => {
    expect.hasAssertions();
    const repo = new PrismaInboundMessageRepository(deps);
    const row = {
      id: "i-1",
      tenantId: "t-1",
      contactId: "c-1",
      providerMessageId: "wamid-1",
      type: "text" as const,
      text: "hi",
      buttonPayload: null,
      contextProviderMessageId: null,
      occurredAt: NOW,
      receivedAt: NOW,
    };
    const dup = recordingClient({
      "inboundMessage.createMany": [{ count: 0 }],
      "inboundMessage.findFirst": [{}],
    });
    expect(await repo.insert(row, dup.tx)).toBe("duplicate");
    expect(dup.calls[0]?.args).toMatchObject({ skipDuplicates: true });
    expect(dup.calls[1]?.args).toEqual({
      where: { tenantId: "t-1", providerMessageId: "wamid-1" },
    });
    const other = recordingClient({ "inboundMessage.createMany": [{ count: 0 }] });
    await expect(repo.insert(row, other.tx)).rejects.toThrow(/unexpected unique conflict/);
    await repo.findByProviderMessageId("t-1", "wamid-1", dup.tx);
    expect(dup.calls[2]?.args).toEqual({
      where: { tenantId: "t-1", providerMessageId: "wamid-1" },
    });
  });

  const unmatchedRow = (over: Record<string, unknown> = {}) => ({
    id: "u-1",
    tenantId: "t-1",
    phoneNumberId: "phone-1",
    providerEventId: "evt-1",
    providerMessageId: "wamid-1",
    correlationId: null,
    status: "sent",
    recipient: "201012345678",
    dispatchWabaId: "waba-1",
    errorCode: null,
    quarantined: false,
    occurredAt: NOW,
    resolvedAt: null,
    createdAt: NOW,
    ...over,
  });
  const repo = new PrismaUnmatchedStatusRepository({
    prisma: NOOP_PRISMA,
    clock: { now: () => NOW },
  });

  it("takeFor filters tenant + phone + unresolved + (message id OR correlation id) and marks each row once", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient({
      "unmatchedStatusEvent.findMany": [[unmatchedRow(), unmatchedRow({ id: "u-2" })]],
      "unmatchedStatusEvent.updateMany": [{ count: 1 }, { count: 0 }],
    });
    const taken = await repo.takeFor(
      "t-1",
      "phone-1",
      { providerMessageId: "wamid-1", correlationId: "c-1" },
      tx,
    );
    expect(calls[0]?.args).toEqual({
      where: {
        tenantId: "t-1",
        phoneNumberId: "phone-1",
        resolvedAt: null,
        OR: [{ providerMessageId: "wamid-1" }, { correlationId: "c-1" }],
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    expect(calls.slice(1).map((c) => c.args)).toEqual([
      { where: { tenantId: "t-1", id: "u-1", resolvedAt: null }, data: { resolvedAt: NOW } },
      { where: { tenantId: "t-1", id: "u-2", resolvedAt: null }, data: { resolvedAt: NOW } },
    ]);
    // the lost race (count 0) is not returned
    expect(taken.map((x: UnmatchedStatusRecord) => x.id)).toEqual(["u-1"]);
    expect(taken[0]?.resolvedAt).toEqual(NOW);
  });

  it("the trust evidence is written to and read from its own columns; status holds only the status (I1)", async () => {
    expect.hasAssertions();
    const insert = recordingClient({ "unmatchedStatusEvent.createMany": [{ count: 1 }] });
    const record: UnmatchedStatusRecord = {
      id: "u-1",
      tenantId: "t-1",
      phoneNumberId: "phone-1",
      providerEventId: "evt-1",
      providerMessageId: "wamid-1",
      correlationId: null,
      status: "failed",
      occurredAt: NOW,
      resolvedAt: null,
      recipientId: "201012345678",
      wabaId: "waba 1&x",
      errorCode: "131026",
      quarantined: true,
    };
    await repo.put(record, insert.tx);
    expect(insert.calls[0]?.args).toEqual({
      data: [
        {
          id: "u-1",
          tenantId: "t-1",
          phoneNumberId: "phone-1",
          providerEventId: "evt-1",
          providerMessageId: "wamid-1",
          correlationId: null,
          status: "failed",
          recipient: "201012345678",
          dispatchWabaId: "waba 1&x",
          errorCode: "131026",
          quarantined: true,
          occurredAt: NOW,
          resolvedAt: null,
        },
      ],
      skipDuplicates: true,
    });
    const back = recordingClient({
      "unmatchedStatusEvent.findMany": [
        [
          unmatchedRow({
            status: "failed",
            recipient: "201012345678",
            dispatchWabaId: "waba 1&x",
            errorCode: "131026",
            quarantined: true,
          }),
        ],
      ],
      "unmatchedStatusEvent.updateMany": [{ count: 1 }],
    });
    const [taken] = await repo.takeFor("t-1", "phone-1", { providerMessageId: "wamid-1" }, back.tx);
    expect(taken).toMatchObject({
      status: "failed",
      recipientId: "201012345678",
      wabaId: "waba 1&x",
      errorCode: "131026",
      quarantined: true,
    });
  });

  it("null evidence columns map to null evidence (never to a matching value)", async () => {
    expect.hasAssertions();
    const nulls = recordingClient({
      "unmatchedStatusEvent.findMany": [
        [unmatchedRow({ status: "delivered", recipient: null, dispatchWabaId: null })],
      ],
      "unmatchedStatusEvent.updateMany": [{ count: 1 }],
    });
    const [taken] = await repo.takeFor(
      "t-1",
      "phone-1",
      { providerMessageId: "wamid-1" },
      nulls.tx,
    );
    expect(taken).toMatchObject({
      status: "delivered",
      recipientId: null,
      wabaId: null,
      errorCode: null,
      quarantined: false,
    });
  });

  it("lockMessage takes a bound transaction-scoped advisory lock on the key, on the caller's transaction", async () => {
    expect.hasAssertions();
    const { tx, raw, calls } = recordingClient();
    await repo.lockMessage("t-1", "phone-1", "wamid-1", tx);
    expect(raw).toHaveLength(1);
    expect(raw[0]?.kind).toBe("executeRaw");
    expect(raw[0]?.sql).toContain("pg_advisory_xact_lock(hashtext(?), hashtext(?))");
    expect(raw[0]?.values).toEqual([
      "outreach.unmatched_status_events",
      JSON.stringify(["t-1", "phone-1", "wamid-1"]),
    ]);
    expect(calls).toEqual([]);
  });

  it("lockMessage without the unit of work's transaction fails closed", async () => {
    expect.hasAssertions();
    await expect(repo.lockMessage("t-1", "phone-1", "wamid-1", undefined)).rejects.toThrow(
      /requires the unit of work/,
    );
  });

  it("takeFor without a criterion touches nothing", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    expect(await repo.takeFor("t-1", "phone-1", {}, tx)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("put: duplicate only for the provider event id", async () => {
    expect.hasAssertions();
    const dup = recordingClient({
      "unmatchedStatusEvent.createMany": [{ count: 0 }],
      "unmatchedStatusEvent.findFirst": [{}],
    });
    const row = { ...unmatchedRow(), status: "sent" as const, createdAt: undefined };
    expect(await repo.put(row as unknown as UnmatchedStatusRecord, dup.tx)).toBe("duplicate");
    expect(dup.calls[1]?.args).toEqual({ where: { tenantId: "t-1", providerEventId: "evt-1" } });
    const other = recordingClient({ "unmatchedStatusEvent.createMany": [{ count: 0 }] });
    await expect(repo.put(row as unknown as UnmatchedStatusRecord, other.tx)).rejects.toThrow(
      /unexpected unique conflict/,
    );
  });
});

describe("PrismaTemplateRepository arguments", () => {
  const repo = new PrismaTemplateRepository(deps);

  it("list/find scope by tenant AND WABA", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await repo.list("t-1", "waba-1", tx);
    await repo.findByNameLanguage("t-1", "waba-1", "promo", "en_US", tx);
    await repo.findByProviderId("t-1", "waba-1", "meta-1", tx);
    expect(calls.map((c) => (c.args as { where: Args }).where)).toEqual([
      { tenantId: "t-1", wabaId: "waba-1" },
      { tenantId: "t-1", wabaId: "waba-1", name: "promo", language: "en_US" },
      { tenantId: "t-1", wabaId: "waba-1", metaTemplateId: "meta-1" },
    ]);
  });

  it("applying an event is a revision CAS (tenant + WABA + id + revision) that increments revision and version", async () => {
    expect.hasAssertions();
    const row = {
      ...templateRecord({ status: "PENDING" }),
      createdAt: NOW,
      updatedAt: NOW,
    };
    const { tx, calls } = recordingClient({ "messageTemplate.findFirst": [row] });
    const outcome = await repo.applyStatusEvent(
      "t-1",
      "waba-1",
      "meta-1",
      { status: "APPROVED", reason: null, eventAt: NOW },
      tx,
    );
    expect(outcome.result).toBe("applied");
    // the transition is the one this compare-and-set made: the row it replaced and the row it wrote
    expect(outcome.change?.before).toMatchObject({ status: "PENDING", revision: 5 });
    expect(outcome.change?.after).toMatchObject({ status: "APPROVED", revision: 6 });
    expect(calls[1]?.args).toEqual({
      where: { tenantId: "t-1", wabaId: "waba-1", id: row.id, revision: 5 },
      data: {
        status: "APPROVED",
        rejectedReason: null,
        statusEventAt: NOW,
        revision: { increment: 1 },
        version: { increment: 1 },
      },
    });
  });

  it("a lost revision CAS is retried on a fresh read and then gives up with a ConcurrencyError", async () => {
    expect.hasAssertions();
    const row = { ...templateRecord({ status: "PENDING" }), createdAt: NOW, updatedAt: NOW };
    const { tx, calls } = recordingClient({
      "messageTemplate.findFirst": [row, row, row],
      "messageTemplate.updateMany": [{ count: 0 }, { count: 0 }, { count: 0 }],
    });
    await expect(
      repo.applyStatusEvent(
        "t-1",
        "waba-1",
        "meta-1",
        { status: "APPROVED", reason: null, eventAt: NOW },
        tx,
      ),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect(calls.filter((c) => c.method === "updateMany")).toHaveLength(3);
  });

  it("insert uses createMany + skipDuplicates at version 1; duplicate only for tenant + WABA + name + language", async () => {
    expect.hasAssertions();
    const created = recordingClient();
    expect(await repo.insert(templateRecord({ version: 0 }), created.tx)).toBe("inserted");
    expect(created.calls[0]?.args).toMatchObject({
      skipDuplicates: true,
      data: [{ version: 1, revision: 5, wabaId: "waba-1" }],
    });
    const dup = recordingClient({
      "messageTemplate.createMany": [{ count: 0 }],
      "messageTemplate.findFirst": [{ ...templateRecord(), createdAt: NOW, updatedAt: NOW }],
    });
    expect(await repo.insert(templateRecord(), dup.tx)).toBe("duplicate");
    expect(dup.calls[1]?.args).toEqual({
      where: { tenantId: "t-1", wabaId: "waba-1", name: "promo", language: "en_US" },
    });
    const other = recordingClient({ "messageTemplate.createMany": [{ count: 0 }] });
    await expect(repo.insert(templateRecord(), other.tx)).rejects.toThrow(
      /unexpected unique conflict/,
    );
  });

  it("markDeletedByName filters tenant + WABA + name and skips rows already deleted", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient();
    await repo.markDeletedByName("t-1", "waba-1", "promo", tx);
    expect(calls[0]?.args).toEqual({
      where: { tenantId: "t-1", wabaId: "waba-1", name: "promo", status: { not: "DELETED" } },
      data: { status: "DELETED", revision: { increment: 1 }, version: { increment: 1 } },
    });
  });

  it("replaceSnapshot reads and writes only inside the tenant + WABA", async () => {
    expect.hasAssertions();
    const row = { ...templateRecord(), createdAt: NOW, updatedAt: NOW };
    const { tx, calls } = recordingClient({ "messageTemplate.findMany": [[row]] });
    const result = await repo.replaceSnapshot(
      "t-1",
      "waba-1",
      [],
      { revisionsAtFetchStart: new Map([["meta-1", 5]]), fetchStartedAt: NOW },
      tx,
    );
    expect(result.statusChanges).toEqual([
      {
        id: row.id,
        metaTemplateId: "meta-1",
        name: "promo",
        language: "en_US",
        category: "UTILITY",
        from: "APPROVED",
        to: "DELETED",
      },
    ]);
    expect((calls[0]?.args as { where: Args }).where).toEqual({
      tenantId: "t-1",
      wabaId: "waba-1",
    });
    expect((calls[1]?.args as { where: Args }).where).toEqual({
      tenantId: "t-1",
      wabaId: "waba-1",
      id: row.id,
      revision: 5,
    });
  });

  it("templatePatchData writes only the keys a patch sets", () => {
    expect.hasAssertions();
    expect(templatePatchData({ status: "UNKNOWN" })).toEqual({ status: "UNKNOWN" });
    expect(templatePatchData({ category: "MARKETING", categoryEventAt: NOW })).toEqual({
      category: "MARKETING",
      categoryEventAt: NOW,
    });
  });
});

describe("PrismaEmailSendCounterRepository", () => {
  const repo = new PrismaEmailSendCounterRepository();
  const limits = { perHour: 3, perDay: 5 };

  it("requires the unit of work's transaction", async () => {
    expect.hasAssertions();
    await expect(repo.reserve("t-1", NOW, limits, undefined)).rejects.toThrow(/transaction client/);
  });

  it("windows are UTC-aligned", () => {
    expect.hasAssertions();
    expect(windowStarts(NOW)).toEqual({
      hour: "2026-11-19T10:00:00.000Z",
      day: "2026-11-19T00:00:00.000Z",
    });
  });

  it("seeds, locks both rows tenant-scoped, then increments only when both are under their limits", async () => {
    expect.hasAssertions();
    const { tx, raw, rawAnswers, execAnswers } = recordingClient();
    execAnswers.push(0, 2);
    rawAnswers.push([
      { window_kind: "day", count: 4 },
      { window_kind: "hour", count: 2 },
    ]);
    expect(await repo.reserve("t-1", NOW, limits, tx)).toBe("reserved");
    expect(raw.map((x) => x.kind)).toEqual(["executeRaw", "queryRaw", "executeRaw"]);
    for (const statement of raw) {
      expect(statement.sql).toContain('"outreach"."email_send_counters"');
      expect(statement.values[0]).toBe("t-1");
    }
    expect(raw[0]?.sql).toContain("ON CONFLICT");
    expect(raw[1]?.sql).toContain('"tenant_id" = ?');
    expect(raw[1]?.sql).toContain("FOR UPDATE");
    expect(raw[2]?.sql).toContain('SET "count" = "count" + 1');
    expect(raw[2]?.sql).toContain('"tenant_id" = ?');
  });

  it("fails closed when a window row is missing, duplicated, or the increment touches fewer than two rows", async () => {
    expect.hasAssertions();
    const missing = recordingClient();
    missing.rawAnswers.push([{ window_kind: "hour", count: 0 }]);
    await expect(repo.reserve("t-1", NOW, limits, missing.tx)).rejects.toThrow(
      /missing after the seed/,
    );
    expect(missing.raw.map((x) => x.kind)).toEqual(["executeRaw", "queryRaw"]);

    const doubled = recordingClient();
    doubled.rawAnswers.push([
      { window_kind: "hour", count: 0 },
      { window_kind: "hour", count: 0 },
    ]);
    await expect(repo.reserve("t-1", NOW, limits, doubled.tx)).rejects.toThrow(
      /missing after the seed/,
    );

    const short = recordingClient();
    short.execAnswers.push(0, 1);
    short.rawAnswers.push([
      { window_kind: "day", count: 0 },
      { window_kind: "hour", count: 0 },
    ]);
    await expect(repo.reserve("t-1", NOW, limits, short.tx)).rejects.toThrow(
      /did not update both windows/,
    );
  });

  it("refuses at the boundary without writing: hour first, then day", async () => {
    expect.hasAssertions();
    const hour = recordingClient();
    hour.rawAnswers.push([
      { window_kind: "day", count: 1 },
      { window_kind: "hour", count: 3 },
    ]);
    expect(await repo.reserve("t-1", NOW, limits, hour.tx)).toBe("hour_cap");
    expect(hour.raw.map((x) => x.kind)).toEqual(["executeRaw", "queryRaw"]);

    const day = recordingClient();
    day.rawAnswers.push([
      { window_kind: "day", count: 5 },
      { window_kind: "hour", count: 0 },
    ]);
    expect(await repo.reserve("t-1", NOW, limits, day.tx)).toBe("day_cap");
    expect(day.raw.map((x) => x.kind)).toEqual(["executeRaw", "queryRaw"]);

    const edge = recordingClient();
    edge.execAnswers.push(0, 2);
    edge.rawAnswers.push([
      { window_kind: "day", count: 4 },
      { window_kind: "hour", count: 2 },
    ]);
    expect(await repo.reserve("t-1", NOW, limits, edge.tx)).toBe("reserved");
  });
});

describe("row mappers", () => {
  it("map a connection row, including lease and onboarding columns", () => {
    expect.hasAssertions();
    const row = {
      ...connectionRecord(),
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(connectionFromRow(row)).toEqual(connectionRecord());
  });

  it("refuse a stored literal outside the union instead of passing it through", () => {
    expect.hasAssertions();
    const base = { ...connectionRecord(), createdAt: NOW, updatedAt: NOW };
    expect(() => connectionFromRow({ ...base, status: "weird" })).toThrow(
      /whatsapp_connections.status/,
    );
    expect(() => connectionFromRow({ ...base, onboardingStage: "nope" })).toThrow(
      /onboarding_stage/,
    );
    expect(() =>
      contactFromRow({
        ...contactRecord(),
        whatsappMarketing: "maybe",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toThrow(/whatsapp_marketing/);
    expect(() =>
      outboundFromRow({
        ...outboundRecord(),
        status: "lost",
        createdAt: NOW,
        updatedAt: NOW,
      } as never),
    ).toThrow(/outbound_messages.status/);
    expect(() =>
      templateFromRow({
        ...templateRecord(),
        status: "REINSTATED",
        createdAt: NOW,
        updatedAt: NOW,
      } as never),
    ).toThrow(/message_templates.status/);
  });

  it("round-trip a template and an outbound row", () => {
    expect.hasAssertions();
    expect(
      templateFromRow({ ...templateRecord(), createdAt: NOW, updatedAt: NOW } as never),
    ).toEqual(templateRecord());
    expect(
      outboundFromRow({ ...outboundRecord(), createdAt: NOW, updatedAt: NOW } as never),
    ).toEqual(outboundRecord());
  });
});

describe("tenant scoping of every read/update/delete", () => {
  it("never issues a find/update/delete whose where lacks the tenant (platform scope for the directory)", async () => {
    expect.hasAssertions();
    const { tx, calls } = recordingClient(
      {
        "whatsAppPhoneDirectory.findFirst": [null, null, null, null, null, null, null],
        "contact.findFirst": [null, null, null, null, null, null],
        "messageTemplate.findFirst": [
          { ...templateRecord(), createdAt: NOW, updatedAt: NOW },
          null,
          null,
          null,
        ],
        "messageTemplate.findMany": [[{ ...templateRecord(), createdAt: NOW, updatedAt: NOW }]],
      },
      "t-1",
    );
    const prisma = NOOP_PRISMA;
    const directory = new PrismaPhoneDirectory({ prisma, platformTenantId: PLATFORM });
    const contacts = new PrismaContactRepository({ prisma });
    const outbound = new PrismaOutboundMessageRepository({ prisma });
    const inbound = new PrismaInboundMessageRepository({ prisma });
    const unmatched = new PrismaUnmatchedStatusRepository({ prisma, clock: { now: () => NOW } });
    const templates = new PrismaTemplateRepository({ prisma });
    const connections = new PrismaWhatsAppConnectionRepository({ prisma });

    await connections.get("t-1", tx);
    await connections.save(connectionRecord(), 2, tx);
    await directory.find("p", tx);
    await directory.findByWaba("w", tx);
    await directory.findByShop("s", tx);
    await directory.claim("p", "w", "s", tx);
    await directory.release("p", "s", tx);
    await contacts.findByPhone("t-1", "+2", tx);
    await contacts.findByEmail("t-1", "e", tx);
    await contacts.findById("t-1", "i", tx);
    await contacts.save(contactRecord(), 1, tx);
    await contacts.saveConsent(contactRecord(), 1, tx);
    await contacts.listConsentEvents("t-1", "c", tx);
    await outbound.findById("t-1", "i", tx);
    await outbound.findByIdempotencyKey("t-1", "k", tx);
    await outbound.findByProviderId("t-1", "p", tx);
    await outbound.findByCorrelationId("t-1", "c", tx);
    await outbound.update(outboundRecord(), 1, tx);
    await outbound.listUnresolved("t-1", NOW, 5, tx);
    await outbound.markUnknownIfPending("t-1", "o", 1, tx);
    await inbound.findByProviderMessageId("t-1", "w", tx);
    await unmatched.takeFor("t-1", "p", { providerMessageId: "w" }, tx);
    await templates.list("t-1", "w", tx);
    await templates.findByNameLanguage("t-1", "w", "n", "l", tx);
    await templates.findByProviderId("t-1", "w", "m", tx);
    await templates.applyCategoryEvent(
      "t-1",
      "w",
      "meta-1",
      { category: "MARKETING", eventAt: NOW },
      tx,
    );
    await templates.markDeletedByName("t-1", "w", "n", tx);

    const scoped = calls.filter((c) =>
      ["findFirst", "findMany", "update", "updateMany", "delete", "deleteMany", "count"].includes(
        c.method,
      ),
    );
    expect(scoped.length).toBeGreaterThan(20);
    for (const call of scoped) {
      const where = call.args["where"] as Args | undefined;
      const tenant = call.model === "whatsAppPhoneDirectory" ? PLATFORM : "t-1";
      expect(where?.["tenantId"], `${call.model}.${call.method}`).toBe(tenant);
    }
  });
});
