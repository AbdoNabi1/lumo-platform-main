import type { Database, TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSettingsValues,
} from "../domain/checkout-settings";
import { InMemoryCheckoutSettingsRepository } from "./in-memory-checkout-settings-repository";
import { PrismaCheckoutSettingsRepository } from "./prisma-checkout-settings-repository";

beforeEach(() => {
  expect.hasAssertions();
});

type Row = Record<string, unknown>;
interface Call {
  readonly op: string;
  readonly args: { where?: Row; data?: Row };
}

/** A stand-in for the one Prisma delegate, honouring only the `where` keys it is given. */
function fakeClient() {
  const rows: Row[] = [];
  const calls: Call[] = [];
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const delegate = {
    findUnique: vi.fn((args: { where: Row }) => {
      calls.push({ op: "findUnique", args });
      const row = rows.find((candidate) => matches(candidate, args.where));
      return Promise.resolve(row === undefined ? null : { ...row });
    }),
    create: vi.fn((args: { data: Row }) => {
      calls.push({ op: "create", args });
      if (rows.some((row) => row["tenantId"] === args.data["tenantId"])) {
        return Promise.reject({ code: "P2002" });
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
  return { client: { checkoutSettings: delegate } as unknown as TransactionClient, rows, calls };
}

const values: CheckoutSettingsValues = {
  ...DEFAULT_CHECKOUT_SETTINGS,
  phoneMode: "optional",
  line2Mode: "hidden",
  cartLineLimit: 7,
};
const repo = () => new PrismaCheckoutSettingsRepository({} as unknown as Database);

describe("PrismaCheckoutSettingsRepository (no database)", () => {
  it("find answers null for a shop with no row", async () => {
    const { client } = fakeClient();
    expect(await repo().find("t-1", client)).toBeNull();
  });

  it("the first save inserts at version 1 and find reads it back", async () => {
    const { client, rows } = fakeClient();
    expect(await repo().save("t-1", values, null, client)).toBe(1);
    expect(rows[0]).toMatchObject({ tenantId: "t-1", phoneMode: "optional", version: 1 });
    expect(await repo().find("t-1", client)).toEqual({ values, version: 1 });
  });

  it("a later save updates where { tenantId, version } and increments", async () => {
    const { client, calls, rows } = fakeClient();
    await repo().save("t-1", values, null, client);
    expect(await repo().save("t-1", DEFAULT_CHECKOUT_SETTINGS, 1, client)).toBe(2);
    const update = calls.find((call) => call.op === "updateMany");
    expect(update?.args.where).toEqual({ tenantId: "t-1", version: 1 });
    expect(update?.args.data?.["version"]).toEqual({ increment: 1 });
    expect(rows[0]).toMatchObject({ version: 2, phoneMode: "required", cartLineLimit: null });
  });

  it("a stale version updates nothing and is a ConcurrencyError", async () => {
    const { client, rows } = fakeClient();
    await repo().save("t-1", values, null, client);
    await repo().save("t-1", DEFAULT_CHECKOUT_SETTINGS, 1, client);
    await expect(repo().save("t-1", values, 1, client)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(rows[0]).toMatchObject({ version: 2, phoneMode: "required" });
  });

  it("two first saves racing: the loser (P2002) is a ConcurrencyError", async () => {
    const { client, rows } = fakeClient();
    await repo().save("t-1", values, null, client);
    await expect(
      repo().save("t-1", DEFAULT_CHECKOUT_SETTINGS, null, client),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect(rows).toHaveLength(1);
  });

  it("every query names tenantId; another tenant's row is neither read nor written", async () => {
    const { client, rows, calls } = fakeClient();
    await repo().save("t-1", values, null, client);
    await repo().save("t-2", DEFAULT_CHECKOUT_SETTINGS, null, client);
    await repo().save("t-1", DEFAULT_CHECKOUT_SETTINGS, 1, client);
    expect((await repo().find("t-2", client))?.version).toBe(1);
    for (const call of calls) expect(call.args.where ?? call.args.data).toHaveProperty("tenantId");
    expect(rows.find((row) => row["tenantId"] === "t-2")).toMatchObject({
      phoneMode: "required",
      version: 1,
    });
  });

  it("a stored value outside the allowed set fails loudly instead of being guessed", async () => {
    const { client, rows } = fakeClient();
    await repo().save("t-1", values, null, client);
    rows[0]!["nameMode"] = "hidden";
    await expect(repo().find("t-1", client)).rejects.toThrow(/Corrupt checkout settings/);
  });
});

describe("InMemoryCheckoutSettingsRepository", () => {
  it("has the same version contract as the Prisma repository", async () => {
    const memory = new InMemoryCheckoutSettingsRepository();
    expect(await memory.find("t-1")).toBeNull();
    expect(await memory.save("t-1", values, null)).toBe(1);
    expect(await memory.save("t-1", DEFAULT_CHECKOUT_SETTINGS, 1)).toBe(2);
    await expect(memory.save("t-1", values, 1)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(memory.save("t-1", values, null)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await memory.find("t-1")).toEqual({ values: DEFAULT_CHECKOUT_SETTINGS, version: 2 });
  });

  it("keeps tenants apart and hands out copies", async () => {
    const memory = new InMemoryCheckoutSettingsRepository();
    await memory.save("t-1", values, null);
    expect(await memory.find("t-2")).toBeNull();
    const read = await memory.find("t-1");
    (read!.values as { phoneMode: string }).phoneMode = "required";
    expect((await memory.find("t-1"))!.values.phoneMode).toBe("optional");
  });
});
