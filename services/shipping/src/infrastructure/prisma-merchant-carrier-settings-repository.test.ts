import type { Database, TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MerchantCarrierSettings } from "../domain/merchant-carrier-settings";
import { PrismaMerchantCarrierSettingsRepository } from "./prisma-merchant-carrier-settings-repository";

beforeEach(() => {
  expect.hasAssertions();
});

type Row = Record<string, unknown>;
interface Call {
  readonly op: string;
  readonly args: { where?: Row; data?: Row };
}

/**
 * A stand-in for the one Prisma delegate, honouring only the `where` keys it is given (an omitted
 * `tenantId` would match every tenant's row, as real Prisma does) and the primary key on create.
 */
function fakeClient() {
  const rows: Row[] = [];
  const calls: Call[] = [];
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  let failNextCreateWith: unknown;
  const delegate = {
    findUnique: vi.fn((args: { where: Row }) => {
      calls.push({ op: "findUnique", args });
      const row = rows.find((candidate) => matches(candidate, args.where));
      return Promise.resolve(row === undefined ? null : { ...row });
    }),
    create: vi.fn((args: { data: Row }) => {
      calls.push({ op: "create", args });
      if (failNextCreateWith !== undefined) {
        const error = failNextCreateWith;
        failNextCreateWith = undefined;
        return Promise.reject(error);
      }
      if (rows.some((row) => row["tenantId"] === args.data["tenantId"])) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError("Unique constraint failed on (`tenant_id`)", {
            code: "P2002",
            clientVersion: "test",
          }),
        );
      }
      rows.push({ ...args.data });
      return Promise.resolve({ ...args.data });
    }),
    updateMany: vi.fn((args: { where: Row; data: Row }) => {
      calls.push({ op: "updateMany", args });
      const found = rows.filter((row) => matches(row, args.where));
      for (const row of found) {
        const { version, ...rest } = args.data;
        Object.assign(row, rest);
        if (typeof version === "object" && version !== null && "increment" in version) {
          row["version"] =
            (row["version"] as number) + (version as { increment: number }).increment;
        }
      }
      return Promise.resolve({ count: found.length });
    }),
  };
  const client = { merchantCarrierSettings: delegate } as unknown as TransactionClient;
  return {
    client,
    delegate,
    rows,
    calls,
    failNextCreate(error: unknown) {
      failNextCreateWith = error;
    },
  };
}

/** A fake `Database` whose `$transaction` records the `app.tenant_id` each transaction scoped. */
function fakeDatabase(client: TransactionClient) {
  const scopedTenants: unknown[] = [];
  const tx = Object.assign(Object.create(null) as object, client, {
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      scopedTenants.push(values[0]);
      return Promise.resolve(1);
    },
  });
  const prisma = {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { prisma, scopedTenants };
}

const stored = (secret = "sealed-whsec") => ({
  config: { awbFormat: "A6", lang: "ar" },
  sealedCredentials: '{"v":1,"ciphertext":"SEALED-CREDS-ENVELOPE"}',
  webhook: { sealedSecret: secret },
});

const repo = () => new PrismaMerchantCarrierSettingsRepository({} as unknown as Database);

describe("PrismaMerchantCarrierSettingsRepository (Ruling 29, preflight F11)", () => {
  it("the first save inserts at version 1; the next load reads version 1", async () => {
    const { client, rows } = fakeClient();
    const settings = MerchantCarrierSettings.empty()
      .withCarrier("bosta", stored())
      .withEnabled("bosta", true);

    await repo().save(settings, "t-1", client);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: "t-1", enabledCarriers: ["bosta"], version: 1 });
    const loaded = await repo().get("t-1", client);
    expect(loaded?.version).toBe(1);
    expect(loaded?.isEnabled("bosta")).toBe(true);
    expect(loaded?.carrier("bosta")).toEqual(stored());
  });

  it("a second save updates where { tenantId, version } and bumps the version", async () => {
    const { client, rows, calls } = fakeClient();
    await repo().save(
      MerchantCarrierSettings.empty().withCarrier("bosta", stored()),
      "t-1",
      client,
    );

    const loaded = (await repo().get("t-1", client))!;
    await repo().save(loaded.withEnabled("bosta", true), "t-1", client);

    const update = calls.find((call) => call.op === "updateMany");
    expect(update?.args.where).toEqual({ tenantId: "t-1", version: 1 });
    expect(update?.args.data?.["version"]).toEqual({ increment: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 2, enabledCarriers: ["bosta"] });
    expect((await repo().get("t-1", client))?.version).toBe(2);
  });

  it("a stale version updates nothing and is a ConcurrencyError", async () => {
    const { client, rows } = fakeClient();
    await repo().save(
      MerchantCarrierSettings.empty().withCarrier("bosta", stored()),
      "t-1",
      client,
    );
    const first = (await repo().get("t-1", client))!;
    const second = (await repo().get("t-1", client))!;
    await repo().save(first.withEnabled("bosta", true), "t-1", client);

    await expect(repo().save(second.withoutCarrier("bosta"), "t-1", client)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    expect(rows[0]).toMatchObject({ version: 2, enabledCarriers: ["bosta"] });
    expect((await repo().get("t-1", client))?.carrier("bosta")).toBeDefined();
  });

  it("a concurrent first insert (P2002) is a ConcurrencyError, not a 500", async () => {
    const { client, rows } = fakeClient();
    await repo().save(
      MerchantCarrierSettings.empty().withCarrier("bosta", stored("a")),
      "t-1",
      client,
    );

    const loser = MerchantCarrierSettings.empty().withCarrier("bosta", stored("b"));
    const error = await repo()
      .save(loser, "t-1", client)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConcurrencyError);
    expect(rows).toHaveLength(1);
    expect((rows[0]!["carrierSettings"] as Row)["bosta"]).toMatchObject({
      webhook: { sealedSecret: "a" },
    });
  });

  it("a plain Prisma P2002 error is translated to a concurrency error", async () => {
    const { client, failNextCreate } = fakeClient();
    failNextCreate({ code: "P2002" });
    await expect(
      repo().save(MerchantCarrierSettings.empty(), "t-1", client),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("any other create failure propagates unchanged", async () => {
    const { client, failNextCreate } = fakeClient();
    const boom = new Error("connection reset");
    failNextCreate(boom);
    await expect(repo().save(MerchantCarrierSettings.empty(), "t-1", client)).rejects.toBe(boom);
  });

  it("every query names tenantId; another tenant's row is neither read nor written", async () => {
    const { client, rows, calls } = fakeClient();
    await repo().save(
      MerchantCarrierSettings.empty().withCarrier("bosta", stored()),
      "t-1",
      client,
    );
    await repo().save(
      MerchantCarrierSettings.empty().withCarrier("bosta", stored("b")),
      "t-2",
      client,
    );
    const t1 = (await repo().get("t-1", client))!;
    await repo().save(t1.withEnabled("bosta", true), "t-1", client);
    expect(await repo().get("t-3", client)).toBeNull();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const tenantId =
        call.op === "create" ? call.args.data?.["tenantId"] : call.args.where?.["tenantId"];
      expect(tenantId, `${call.op} must name tenantId`).toEqual(expect.any(String));
    }
    const t2Row = rows.find((row) => row["tenantId"] === "t-2");
    expect(t2Row).toMatchObject({ version: 1, enabledCarriers: [] });
  });

  it("round-trips previous webhook secrets, writing previousValidUntil as an ISO string", async () => {
    const { client, rows, delegate } = fakeClient();
    const rotated = MerchantCarrierSettings.empty()
      .withCarrier("bosta", stored("old"))
      .withRotatedWebhook("bosta", "new", new Date("2026-11-12T00:00:00.000Z"));

    await repo().save(rotated, "t-1", client);
    expect(delegate.create).toHaveBeenCalledOnce();
    expect(delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1 }) }),
    );

    const json = rows[0]!["carrierSettings"] as Record<string, { webhook: Row }>;
    expect(json["bosta"]!.webhook).toEqual({
      sealedSecret: "new",
      previousSealedSecret: "old",
      previousValidUntil: "2026-11-19T00:00:00.000Z",
    });
    const loaded = await repo().get("t-1", client);
    expect(loaded?.carrier("bosta")?.webhook).toEqual({
      sealedSecret: "new",
      previousSealedSecret: "old",
      previousValidUntil: new Date("2026-11-19T00:00:00.000Z"),
    });
  });

  it.each([
    ["not an object", { enabledCarriers: [], carrierSettings: [] }],
    ["a malformed carrier key", { enabledCarriers: [], carrierSettings: { Bosta: stored() } }],
    ["a malformed enabled key", { enabledCarriers: ["Bad Key"], carrierSettings: {} }],
    [
      "a non-string sealed credential",
      { enabledCarriers: [], carrierSettings: { bosta: { ...stored(), sealedCredentials: 7 } } },
    ],
    [
      "a missing config",
      {
        enabledCarriers: [],
        carrierSettings: {
          bosta: { sealedCredentials: "SEALED-X", webhook: { sealedSecret: "S" } },
        },
      },
    ],
    [
      "a missing webhook secret",
      {
        enabledCarriers: [],
        carrierSettings: { bosta: { config: {}, sealedCredentials: "SEALED-X", webhook: {} } },
      },
    ],
    [
      "a previous secret without its expiry",
      {
        enabledCarriers: [],
        carrierSettings: {
          bosta: {
            config: {},
            sealedCredentials: "SEALED-X",
            webhook: { sealedSecret: "S", previousSealedSecret: "SEALED-PREV" },
          },
        },
      },
    ],
    [
      "an unparseable expiry",
      {
        enabledCarriers: [],
        carrierSettings: {
          bosta: {
            config: {},
            sealedCredentials: "SEALED-X",
            webhook: {
              sealedSecret: "S",
              previousSealedSecret: "SEALED-PREV",
              previousValidUntil: "SEALED-not-a-date",
            },
          },
        },
      },
    ],
    [
      "an unknown entry field",
      {
        enabledCarriers: [],
        carrierSettings: { bosta: { ...stored(), apiKey: "SEALED-plaintext-leak" } },
      },
    ],
  ])("%s fails loudly as corruption, naming no key value or envelope", async (_label, columns) => {
    const { client, rows } = fakeClient();
    rows.push({ tenantId: "t-1", version: 3, ...columns });

    const error = await repo()
      .get("t-1", client)
      .catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Corrupt merchant carrier settings: /);
    expect((error as Error).message).not.toMatch(/SEALED|Bosta|Bad Key/);
  });

  it("without a tx, reads and writes run in a transaction scoped to the tenant", async () => {
    const { client, rows } = fakeClient();
    const { prisma, scopedTenants } = fakeDatabase(client);
    const repository = new PrismaMerchantCarrierSettingsRepository(prisma);

    await repository.save(MerchantCarrierSettings.empty().withCarrier("bosta", stored()), "t-9");
    const loaded = await repository.get("t-9");

    expect(rows).toHaveLength(1);
    expect(loaded?.version).toBe(1);
    expect(scopedTenants).toEqual(["t-9", "t-9"]);
  });
});
