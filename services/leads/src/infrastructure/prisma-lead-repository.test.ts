import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";
import { leadOf, leadProps } from "../testing/fixtures";
import { PrismaLeadRepository } from "./prisma-lead-repository";
import type { LeadRow } from "./rows";

beforeEach(() => {
  expect.hasAssertions();
});

interface Call {
  model: string;
  method: string;
  args: unknown;
}

const METHOD_DEFAULTS: Record<string, unknown> = {
  create: null,
  findFirst: null,
  updateMany: { count: 0 },
  findMany: [],
};

/**
 * A recording stand-in for the Prisma client (NOT `createFakePrisma`: that fake rejects `OR`, has no
 * `contains`/`mode` and ignores `orderBy`, so it cannot prove list/search semantics). It records every
 * delegate call and every `$executeRaw` (as `{ model: "$raw", method: "executeRaw", args: <tenant id> }`),
 * `$transaction(fn)` runs `fn` with the same client, and each delegate method returns the next queued
 * value from `results["<model>.<method>"]` (else a default by method kind).
 */
function recordingPrisma(results: Partial<Record<string, unknown[]>> = {}) {
  const calls: Call[] = [];
  const queues = new Map<string, unknown[]>(
    Object.entries(results).map(([key, values]) => [key, [...(values ?? [])]]),
  );
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => (args: unknown) => {
          calls.push({ model, method, args });
          const queue = queues.get(`${model}.${method}`);
          if (queue !== undefined && queue.length > 0) {
            const next = queue.shift();
            if (next instanceof Error) return Promise.reject(next);
            return Promise.resolve(next);
          }
          return Promise.resolve(METHOD_DEFAULTS[method] ?? null);
        },
      },
    );
  const client: Record<string, unknown> = {
    lead: delegate("lead"),
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ model: "$raw", method: "executeRaw", args: values[0] });
      return Promise.resolve(1);
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return { prisma: client as unknown as Database, calls };
}

const id = (n: number): string => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-11-22T10:00:00.000Z");

function rowOf(over: Partial<LeadRow> = {}): LeadRow {
  const p = leadProps({ id: id(1) });
  return {
    id: p.id,
    tenantId: "t-1",
    formId: p.formId,
    name: p.name,
    phone: p.phone,
    phoneE164: p.phoneE164,
    email: p.email,
    message: p.message,
    status: p.status,
    trackingStatus: p.trackingStatus,
    eventId: p.eventId,
    sessionId: p.sessionId,
    submissionKey: p.submissionKey,
    spamReason: p.spamReason,
    attribution: p.attribution,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...over,
  };
}

/** Every query is preceded by the set_config call for the same tenant, and names the tenant in `where`. */
function expectTenantScoped(calls: Call[], tenantId: string): void {
  const queries = calls.filter((c) => c.model !== "$raw");
  expect(queries.length).toBeGreaterThan(0);
  calls.forEach((call, index) => {
    if (call.model === "$raw") return;
    const prev = calls[index - 1];
    expect(prev).toEqual({ model: "$raw", method: "executeRaw", args: tenantId });
    if (call.method !== "create") {
      expect((call.args as { where: { tenantId: string } }).where.tenantId).toBe(tenantId);
    } else {
      expect((call.args as { data: { tenantId: string } }).data.tenantId).toBe(tenantId);
    }
  });
}

function p2002(target: unknown): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target },
  });
}

describe("PrismaLeadRepository.insert", () => {
  it("creates the row inside a tenant transaction, with the tenant id from the argument", async () => {
    const { prisma, calls } = recordingPrisma();
    const repo = new PrismaLeadRepository({ prisma });
    const lead = leadOf({
      id: id(1),
      submissionKey: "key-insert-01",
      message: "hello",
      attribution: {
        pageUrl: "https://shop.example/",
        referrer: null,
        ip: "203.0.113.9",
        userAgent: "ua",
        cookies: { fbp: "fb.1.2.3" },
      },
    });
    expect(await repo.insert("t-1", lead)).toBe("inserted");
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "lead",
        method: "create",
        args: {
          data: {
            id: id(1),
            tenantId: "t-1",
            formId: lead.props.formId,
            name: lead.props.name,
            phone: lead.props.phone,
            phoneE164: lead.props.phoneE164,
            email: lead.props.email,
            message: "hello",
            status: "new",
            trackingStatus: "pending",
            eventId: lead.props.eventId,
            sessionId: "s-1",
            submissionKey: "key-insert-01",
            spamReason: null,
            attribution: lead.props.attribution,
            version: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      },
    ]);
    expectTenantScoped(calls, "t-1");
  });

  it("answers duplicate for a P2002 on the (tenant, submission key) unique index", async () => {
    for (const target of [["tenant_id", "submission_key"], "leads_tenant_id_submission_key_key"]) {
      const { prisma } = recordingPrisma({ "lead.create": [p2002(target)] });
      expect(await new PrismaLeadRepository({ prisma }).insert("t-1", leadOf())).toBe("duplicate");
    }
  });

  it("rethrows a P2002 on any other constraint (a primary-key clash is a bug, not a retry)", async () => {
    const { prisma } = recordingPrisma({ "lead.create": [p2002(["id"])] });
    await expect(new PrismaLeadRepository({ prisma }).insert("t-1", leadOf())).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it("rethrows any non-unique error", async () => {
    const { prisma } = recordingPrisma({ "lead.create": [new Error("connection lost")] });
    await expect(new PrismaLeadRepository({ prisma }).insert("t-1", leadOf())).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("PrismaLeadRepository.get / findBySubmissionKey", () => {
  it("get reads by id and tenant, after set_config, and maps every field back (attribution included)", async () => {
    const attribution = {
      pageUrl: "https://shop.example/",
      referrer: "https://google.com/",
      ip: "203.0.113.9",
      userAgent: "ua",
      cookies: { fbp: "fb.1.2.3", ga: "GA1.2.3" },
    };
    const row = rowOf({
      message: "hi",
      spamReason: "honeypot",
      status: "spam",
      trackingStatus: "skipped_spam",
      version: 2,
      attribution,
    });
    const { prisma, calls } = recordingPrisma({ "lead.findFirst": [row] });
    const lead = await new PrismaLeadRepository({ prisma }).get("t-1", id(1));
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      { model: "lead", method: "findFirst", args: { where: { id: id(1), tenantId: "t-1" } } },
    ]);
    expect(lead?.props).toEqual({
      id: id(1),
      formId: row.formId,
      name: row.name,
      phone: row.phone,
      phoneE164: row.phoneE164,
      email: row.email,
      message: "hi",
      status: "spam",
      trackingStatus: "skipped_spam",
      eventId: row.eventId,
      sessionId: row.sessionId,
      submissionKey: row.submissionKey,
      spamReason: "honeypot",
      attribution,
      version: 2,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("get returns null when the row is absent (another tenant's row is never selected)", async () => {
    const { prisma, calls } = recordingPrisma();
    expect(await new PrismaLeadRepository({ prisma }).get("t-2", id(1))).toBeNull();
    expect(calls[0]).toEqual({ model: "$raw", method: "executeRaw", args: "t-2" });
    expect(calls[1]?.args).toEqual({ where: { id: id(1), tenantId: "t-2" } });
  });

  it("get with a malformed id is null without touching the database (a uuid column would throw)", async () => {
    const { prisma, calls } = recordingPrisma();
    expect(await new PrismaLeadRepository({ prisma }).get("t-1", "not-a-uuid")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("findBySubmissionKey reads by tenant and key after set_config", async () => {
    const { prisma, calls } = recordingPrisma({
      "lead.findFirst": [rowOf({ submissionKey: "key-find-0001" })],
    });
    const lead = await new PrismaLeadRepository({ prisma }).findBySubmissionKey(
      "t-1",
      "key-find-0001",
    );
    expect(lead?.props.submissionKey).toBe("key-find-0001");
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "lead",
        method: "findFirst",
        args: { where: { tenantId: "t-1", submissionKey: "key-find-0001" } },
      },
    ]);
  });

  it("findBySubmissionKey is null when nothing matches", async () => {
    const { prisma } = recordingPrisma();
    expect(await new PrismaLeadRepository({ prisma }).findBySubmissionKey("t-1", "k")).toBeNull();
  });
});

describe("PrismaLeadRepository mapper", () => {
  it("throws on an unknown status, tracking status or spam reason, naming the column", async () => {
    const cases: [Partial<LeadRow>, RegExp][] = [
      [{ status: "x" }, /leads\.status is not valid: x/],
      [{ trackingStatus: "y" }, /leads\.tracking_status is not valid: y/],
      [{ spamReason: "z" }, /leads\.spam_reason is not valid: z/],
    ];
    for (const [over, message] of cases) {
      const { prisma } = recordingPrisma({ "lead.findFirst": [rowOf(over)] });
      await expect(new PrismaLeadRepository({ prisma }).get("t-1", id(1))).rejects.toThrow(message);
    }
  });

  it("reads a malformed attribution document as empty attribution instead of failing", async () => {
    const { prisma } = recordingPrisma({
      "lead.findFirst": [rowOf({ attribution: "nope" as unknown as LeadRow["attribution"] })],
    });
    const lead = await new PrismaLeadRepository({ prisma }).get("t-1", id(1));
    expect(lead?.props.attribution).toEqual({
      pageUrl: null,
      referrer: null,
      ip: null,
      userAgent: null,
      cookies: {},
    });
  });
});

describe("PrismaLeadRepository.updateStatus", () => {
  it("updates only the matching version, setting status, version and updatedAt; count 1 is true", async () => {
    const { prisma, calls } = recordingPrisma({ "lead.updateMany": [{ count: 1 }] });
    const at = new Date("2026-11-23T00:00:00.000Z");
    const next = leadOf({ id: id(1) }).withStatus("contacted", at);
    expect(await new PrismaLeadRepository({ prisma }).updateStatus("t-1", next)).toBe(true);
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "lead",
        method: "updateMany",
        args: {
          where: { id: id(1), tenantId: "t-1", version: 0 },
          data: { status: "contacted", version: 1, updatedAt: at },
        },
      },
    ]);
  });

  it("is false for a stale version (count 0)", async () => {
    const { prisma, calls } = recordingPrisma({ "lead.updateMany": [{ count: 0 }] });
    const stale = leadOf({ id: id(1), version: 4 }).withStatus("qualified", NOW);
    expect(await new PrismaLeadRepository({ prisma }).updateStatus("t-1", stale)).toBe(false);
    expect((calls[1]?.args as { where: { version: number } }).where.version).toBe(4);
  });

  it("is false without touching the database for a malformed id", async () => {
    const { prisma, calls } = recordingPrisma();
    const next = leadOf({ id: "nope" }).withStatus("contacted", NOW);
    expect(await new PrismaLeadRepository({ prisma }).updateStatus("t-1", next)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("PrismaLeadRepository.list", () => {
  const listCall = (calls: Call[]): Call => {
    const call = calls.find((c) => c.model === "lead");
    if (call === undefined) throw new Error("no lead query recorded");
    return call;
  };

  it("lists newest first with take first + 1, scoped to the tenant", async () => {
    const { prisma, calls } = recordingPrisma({
      "lead.findMany": [[rowOf({ id: id(3) }), rowOf({ id: id(2) })]],
    });
    const page = await new PrismaLeadRepository({ prisma }).list("t-1", { first: 2 });
    expect(page.map((l) => l.props.id)).toEqual([id(3), id(2)]);
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "lead",
        method: "findMany",
        args: { where: { tenantId: "t-1" }, orderBy: { id: "desc" }, take: 3 },
      },
    ]);
    expectTenantScoped(calls, "t-1");
  });

  it("applies the cursor as id < after", async () => {
    const { prisma, calls } = recordingPrisma();
    await new PrismaLeadRepository({ prisma }).list("t-1", { first: 10, after: id(3) });
    expect(listCall(calls).args).toEqual({
      where: { tenantId: "t-1", id: { lt: id(3) } },
      orderBy: { id: "desc" },
      take: 11,
    });
  });

  it("answers an empty page without a query for a malformed cursor", async () => {
    const { prisma, calls } = recordingPrisma();
    expect(
      await new PrismaLeadRepository({ prisma }).list("t-1", { first: 10, after: "zz" }),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("filters by status and by the createdAt range (inclusive both ends)", async () => {
    const { prisma, calls } = recordingPrisma();
    const from = new Date("2026-11-05T00:00:00.000Z");
    const to = new Date("2026-11-15T00:00:00.000Z");
    const repo = new PrismaLeadRepository({ prisma });
    await repo.list("t-1", { first: 5, status: "spam", createdFrom: from, createdTo: to });
    await repo.list("t-1", { first: 5, createdFrom: from });
    await repo.list("t-1", { first: 5, createdTo: to });
    const queries = calls.filter((c) => c.model === "lead").map((c) => c.args);
    expect(queries).toEqual([
      {
        where: { tenantId: "t-1", status: "spam", createdAt: { gte: from, lte: to } },
        orderBy: { id: "desc" },
        take: 6,
      },
      { where: { tenantId: "t-1", createdAt: { gte: from } }, orderBy: { id: "desc" }, take: 6 },
      { where: { tenantId: "t-1", createdAt: { lte: to } }, orderBy: { id: "desc" }, take: 6 },
    ]);
  });

  it("searches name and email case-insensitively, and phone digits only from three digits up", async () => {
    const { prisma, calls } = recordingPrisma();
    const repo = new PrismaLeadRepository({ prisma });
    await repo.list("t-1", { first: 5, search: "  Ahmed " });
    await repo.list("t-1", { first: 5, search: "+20 101" });
    await repo.list("t-1", { first: 5, search: "١٢٣٤" });
    await repo.list("t-1", { first: 5, search: "12" });
    await repo.list("t-1", { first: 5, search: "   " });
    const wheres = calls
      .filter((c) => c.model === "lead")
      .map((c) => (c.args as { where: unknown }).where);
    expect(wheres).toEqual([
      {
        tenantId: "t-1",
        OR: [
          { name: { contains: "Ahmed", mode: "insensitive" } },
          { email: { contains: "Ahmed", mode: "insensitive" } },
        ],
      },
      {
        tenantId: "t-1",
        OR: [
          { name: { contains: "+20 101", mode: "insensitive" } },
          { email: { contains: "+20 101", mode: "insensitive" } },
          { phoneE164: { contains: "20101" } },
        ],
      },
      {
        tenantId: "t-1",
        OR: [
          { name: { contains: "١٢٣٤", mode: "insensitive" } },
          { email: { contains: "١٢٣٤", mode: "insensitive" } },
          { phoneE164: { contains: "1234" } },
        ],
      },
      {
        tenantId: "t-1",
        OR: [
          { name: { contains: "12", mode: "insensitive" } },
          { email: { contains: "12", mode: "insensitive" } },
        ],
      },
      { tenantId: "t-1" },
    ]);
  });

  it("combines every filter in one where, never dropping the tenant", async () => {
    const { prisma, calls } = recordingPrisma();
    const at = new Date("2026-11-10T00:00:00.000Z");
    await new PrismaLeadRepository({ prisma }).list("t-9", {
      first: 20,
      after: id(7),
      status: "new",
      search: "bot",
      createdFrom: at,
    });
    expect(listCall(calls).args).toEqual({
      where: {
        tenantId: "t-9",
        id: { lt: id(7) },
        status: "new",
        createdAt: { gte: at },
        OR: [
          { name: { contains: "bot", mode: "insensitive" } },
          { email: { contains: "bot", mode: "insensitive" } },
        ],
      },
      orderBy: { id: "desc" },
      take: 21,
    });
    expectTenantScoped(calls, "t-9");
  });
});
