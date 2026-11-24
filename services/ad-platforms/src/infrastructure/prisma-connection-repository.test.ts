import type { Database } from "@platform/db";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { AD_PLATFORMS, Connection, type ConnectionProps } from "../domain/connection";
import { PrismaConnectionRepository } from "./prisma-connection-repository";
import type { AdPlatformConnectionRow } from "./rows";

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
 * A recording stand-in for the Prisma client (NOT `createFakePrisma`: it models neither constraints nor
 * `$executeRaw`). It records every delegate call and every `$executeRaw` (as
 * `{ model: "$raw", method: "executeRaw", args: <tenant id> }`), `$transaction(fn)` runs `fn` with the same
 * client, and each delegate method returns the next queued value from `results["<model>.<method>"]` (an
 * `Error` is rejected), else a default by method kind.
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
    adPlatformConnection: delegate("adPlatformConnection"),
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ model: "$raw", method: "executeRaw", args: values[0] });
      return Promise.resolve(1);
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return { prisma: client as unknown as Database, calls };
}

const id = (n: number): string => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-11-23T10:00:00.000Z");
const LATER = new Date("2026-11-24T10:00:00.000Z");
const SEALED = '{"v":1,"alias":"ad-platform-credentials","wrappedDek":"w","ciphertext":"c"}';

function propsOf(over: Partial<ConnectionProps> = {}): ConnectionProps {
  return {
    id: id(1),
    platform: "meta",
    enabled: true,
    publicConfig: { platform: "meta", pixelId: "123456789012345" },
    sealedSecret: SEALED,
    secretLast4: "abcd",
    testEventCode: "TEST123",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function rowOf(over: Partial<AdPlatformConnectionRow> = {}): AdPlatformConnectionRow {
  return {
    id: id(1),
    tenantId: "t-1",
    platform: "meta",
    enabled: true,
    publicConfig: { platform: "meta", pixelId: "123456789012345" },
    sealedSecret: SEALED,
    secretLast4: "abcd",
    testEventCode: "TEST123",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** Every query is preceded by the set_config call for the same tenant, and names the tenant. */
function expectTenantScoped(calls: Call[], tenantId: string): void {
  const queries = calls.filter((c) => c.model !== "$raw");
  expect(queries.length).toBeGreaterThan(0);
  calls.forEach((call, index) => {
    if (call.model === "$raw") return;
    expect(calls[index - 1]).toEqual({ model: "$raw", method: "executeRaw", args: tenantId });
    if (call.method === "create") {
      expect((call.args as { data: { tenantId: string } }).data.tenantId).toBe(tenantId);
    } else {
      expect((call.args as { where: { tenantId: string } }).where.tenantId).toBe(tenantId);
    }
  });
}

function p2002(target: unknown): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });
}

describe("PrismaConnectionRepository.save (insert)", () => {
  it("creates the row inside a tenant transaction with the tenant id from the argument and every column", async () => {
    const { prisma, calls } = recordingPrisma();
    const connection = Connection.restore(propsOf());
    expect(await new PrismaConnectionRepository({ prisma }).save("t-1", connection, null)).toBe(
      true,
    );
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "adPlatformConnection",
        method: "create",
        args: {
          data: {
            id: id(1),
            tenantId: "t-1",
            platform: "meta",
            enabled: true,
            publicConfig: { platform: "meta", pixelId: "123456789012345" },
            sealedSecret: SEALED,
            secretLast4: "abcd",
            testEventCode: "TEST123",
            version: 1,
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      },
    ]);
    expectTenantScoped(calls, "t-1");
  });

  it("writes an absent public config as SQL NULL (Prisma.DbNull), never the JSON literal null", async () => {
    const { prisma, calls } = recordingPrisma();
    const connection = Connection.restore(
      propsOf({
        enabled: false,
        publicConfig: null,
        sealedSecret: null,
        secretLast4: null,
        testEventCode: null,
      }),
    );
    await new PrismaConnectionRepository({ prisma }).save("t-1", connection, null);
    const data = (calls[1]?.args as { data: { publicConfig: unknown; sealedSecret: unknown } })
      .data;
    expect(data.publicConfig).toBe(Prisma.DbNull);
    expect(data.sealedSecret).toBeNull();
  });

  it("takes the tenant from the argument, not from anything on the connection", async () => {
    const { prisma, calls } = recordingPrisma();
    await new PrismaConnectionRepository({ prisma }).save(
      "t-9",
      Connection.restore(propsOf()),
      null,
    );
    expect(calls[0]).toEqual({ model: "$raw", method: "executeRaw", args: "t-9" });
    expectTenantScoped(calls, "t-9");
  });

  it("answers false for a P2002 on the (tenant, platform) unique index", async () => {
    for (const target of [
      ["tenant_id", "platform"],
      "ad_platform_connections_tenant_id_platform_key",
    ]) {
      const { prisma } = recordingPrisma({ "adPlatformConnection.create": [p2002(target)] });
      expect(
        await new PrismaConnectionRepository({ prisma }).save(
          "t-1",
          Connection.restore(propsOf()),
          null,
        ),
      ).toBe(false);
    }
  });

  it.each([
    ["the primary key", ["id"]],
    ["the platform column alone", ["platform"]],
    ["the tenant column alone", ["tenant_id"]],
    ["a different first column with platform", ["other", "platform"]],
    ["the right columns reversed", ["platform", "tenant_id"]],
    ["an extra column", ["tenant_id", "platform", "id"]],
    [
      "a string that merely contains the index name",
      "x_ad_platform_connections_tenant_id_platform_key_y",
    ],
    ["the bare word platform", "platform"],
    ["no target", undefined],
    ["an empty target", []],
  ])(
    "rethrows a P2002 on %s (not the (tenant, platform) index: a bug, not a lost race)",
    async (_name, target) => {
      const { prisma } = recordingPrisma({ "adPlatformConnection.create": [p2002(target)] });
      await expect(
        new PrismaConnectionRepository({ prisma }).save("t-1", Connection.restore(propsOf()), null),
      ).rejects.toThrow(/Unique constraint/);
    },
  );

  it("rethrows any non-unique error", async () => {
    const { prisma } = recordingPrisma({
      "adPlatformConnection.create": [new Error("connection lost")],
    });
    await expect(
      new PrismaConnectionRepository({ prisma }).save("t-1", Connection.restore(propsOf()), null),
    ).rejects.toThrow("connection lost");
  });
});

describe("PrismaConnectionRepository.save (optimistic update)", () => {
  it("updates only the row at the expected version, never touching identity columns; count 1 is true", async () => {
    const { prisma, calls } = recordingPrisma({
      "adPlatformConnection.updateMany": [{ count: 1 }],
    });
    const next = Connection.restore(
      propsOf({ version: 3, enabled: false, updatedAt: LATER, secretLast4: "wxyz" }),
    );
    expect(await new PrismaConnectionRepository({ prisma }).save("t-1", next, 2)).toBe(true);
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "adPlatformConnection",
        method: "updateMany",
        args: {
          where: { tenantId: "t-1", platform: "meta", version: 2 },
          data: {
            enabled: false,
            publicConfig: { platform: "meta", pixelId: "123456789012345" },
            sealedSecret: SEALED,
            secretLast4: "wxyz",
            testEventCode: "TEST123",
            version: 3,
            updatedAt: LATER,
          },
        },
      },
    ]);
    expectTenantScoped(calls, "t-1");
  });

  it("is false for a stale version (count 0)", async () => {
    const { prisma, calls } = recordingPrisma({
      "adPlatformConnection.updateMany": [{ count: 0 }],
    });
    const stale = Connection.restore(propsOf({ version: 5 }));
    expect(await new PrismaConnectionRepository({ prisma }).save("t-1", stale, 4)).toBe(false);
    expect((calls[1]?.args as { where: { version: number } }).where.version).toBe(4);
  });

  it("clears a removed secret and an absent public config with SQL NULLs", async () => {
    const { prisma, calls } = recordingPrisma({
      "adPlatformConnection.updateMany": [{ count: 1 }],
    });
    const cleared = Connection.restore(
      propsOf({
        version: 2,
        enabled: false,
        publicConfig: null,
        sealedSecret: null,
        secretLast4: null,
      }),
    );
    await new PrismaConnectionRepository({ prisma }).save("t-1", cleared, 1);
    const data = (calls[1]?.args as { data: Record<string, unknown> }).data;
    expect(data["publicConfig"]).toBe(Prisma.DbNull);
    expect(data["sealedSecret"]).toBeNull();
    expect(data["secretLast4"]).toBeNull();
  });
});

describe("PrismaConnectionRepository.get / list", () => {
  it("get reads by tenant and platform after set_config and maps every column back", async () => {
    const { prisma, calls } = recordingPrisma({ "adPlatformConnection.findFirst": [rowOf()] });
    const found = await new PrismaConnectionRepository({ prisma }).get("t-1", "meta");
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "adPlatformConnection",
        method: "findFirst",
        args: { where: { tenantId: "t-1", platform: "meta" } },
      },
    ]);
    expect(found?.props).toEqual(propsOf());
  });

  it("get is null when the row is absent (another tenant's row is never selected)", async () => {
    const { prisma, calls } = recordingPrisma();
    expect(await new PrismaConnectionRepository({ prisma }).get("t-2", "meta")).toBeNull();
    expect(calls[0]).toEqual({ model: "$raw", method: "executeRaw", args: "t-2" });
    expect(calls[1]?.args).toEqual({ where: { tenantId: "t-2", platform: "meta" } });
  });

  it("list reads every row of the tenant, ordered by platform, scoped to the tenant", async () => {
    const { prisma, calls } = recordingPrisma({
      "adPlatformConnection.findMany": [
        [
          rowOf({
            platform: "ga4",
            publicConfig: { platform: "ga4", measurementId: "G-ABCD1234" },
            testEventCode: null,
          }),
          rowOf({ platform: "meta" }),
        ],
      ],
    });
    const rows = await new PrismaConnectionRepository({ prisma }).list("t-1");
    expect(rows.map((r) => r.props.platform)).toEqual(["ga4", "meta"]);
    expect(calls).toEqual([
      { model: "$raw", method: "executeRaw", args: "t-1" },
      {
        model: "adPlatformConnection",
        method: "findMany",
        args: { where: { tenantId: "t-1" }, orderBy: { platform: "asc" } },
      },
    ]);
    expectTenantScoped(calls, "t-1");
  });

  it("list for another shop names only that shop", async () => {
    const { prisma, calls } = recordingPrisma();
    expect(await new PrismaConnectionRepository({ prisma }).list("t-2")).toEqual([]);
    expectTenantScoped(calls, "t-2");
  });
});

describe("PrismaConnectionRepository mapper", () => {
  it("round-trips every platform's public config", async () => {
    const configs = {
      meta: { platform: "meta", pixelId: "123456789012345" },
      tiktok: { platform: "tiktok", pixelCode: "C1234567890ABCDEF" },
      snap: { platform: "snap", pixelId: "123e4567-e89b-12d3-a456-426614174000" },
      ga4: { platform: "ga4", measurementId: "G-ABCD1234" },
      google_ads: {
        platform: "google_ads",
        conversionId: "AW-123456789",
        labels: { lead: "abc_DEF-1", purchase: "xyz" },
      },
    } as const;
    for (const platform of AD_PLATFORMS) {
      const { prisma } = recordingPrisma({
        "adPlatformConnection.findFirst": [
          rowOf({
            platform,
            publicConfig: configs[platform],
            sealedSecret: null,
            secretLast4: null,
          }),
        ],
      });
      const found = await new PrismaConnectionRepository({ prisma }).get("t-1", platform);
      expect(found?.props.publicConfig).toEqual(configs[platform]);
    }
  });

  it("reads a SQL NULL public config as null", async () => {
    const { prisma } = recordingPrisma({
      "adPlatformConnection.findFirst": [rowOf({ enabled: false, publicConfig: null })],
    });
    const found = await new PrismaConnectionRepository({ prisma }).get("t-1", "meta");
    expect(found?.props.publicConfig).toBeNull();
  });

  it("throws, naming the column but never the value, on an unknown platform", async () => {
    const { prisma } = recordingPrisma({
      "adPlatformConnection.findFirst": [rowOf({ platform: "myspace-secret-value" })],
    });
    const failure = new PrismaConnectionRepository({ prisma }).get("t-1", "meta");
    await expect(failure).rejects.toThrow("ad_platform_connections.platform is not valid");
    await expect(failure).rejects.not.toThrow(/myspace/);
  });

  it("throws on a public config that fails validation, or that belongs to another platform", async () => {
    const bad: unknown[] = [
      { platform: "meta", pixelId: "abc" },
      { platform: "tiktok", pixelCode: "C1234567890ABCDEF" },
      "nope",
      [],
    ];
    for (const publicConfig of bad) {
      const { prisma } = recordingPrisma({
        "adPlatformConnection.findFirst": [rowOf({ publicConfig })],
      });
      await expect(new PrismaConnectionRepository({ prisma }).get("t-1", "meta")).rejects.toThrow(
        "ad_platform_connections.public_config is not valid",
      );
    }
  });
});
