import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPaymentSealedCredentialStore } from "./prisma-sealed-credential-store";

beforeEach(() => {
  expect.hasAssertions();
});

type Row = {
  tenantId: string;
  enabledMethods: string[];
  providerSettings: unknown;
  updatedAt: Date;
};

const T0 = new Date("2026-11-01T00:00:00.000Z");

function settings(sealed: string, extra: Record<string, unknown> = {}): Row["providerSettings"] {
  return { paymob: { config: { region: "egy" }, sealedCredentials: sealed }, ...extra };
}

/** A stand-in for the one Prisma delegate: honours only the `where` keys it is given. */
function fake(rows: Row[], hooks: { beforeUpdate?: (row: Row) => void } = {}) {
  const scopedTenants: unknown[] = [];
  const delegate = {
    findMany: vi.fn(
      (args: {
        orderBy: { tenantId: "asc" };
        take: number;
        cursor?: { tenantId: string };
        skip?: number;
      }) => {
        const sorted = [...rows].sort((a, b) => a.tenantId.localeCompare(b.tenantId));
        const start =
          args.cursor === undefined
            ? 0
            : sorted.findIndex((row) => row.tenantId === args.cursor?.tenantId) + (args.skip ?? 0);
        return Promise.resolve(
          sorted.slice(start, start + args.take).map((row) => ({ tenantId: row.tenantId })),
        );
      },
    ),
    findUnique: vi.fn((args: { where: { tenantId: string } }) => {
      const row = rows.find((candidate) => candidate.tenantId === args.where.tenantId);
      return Promise.resolve(row === undefined ? null : structuredClone(row));
    }),
    updateMany: vi.fn(
      (args: {
        where: { tenantId: string; updatedAt: Date };
        data: { providerSettings: unknown };
      }) => {
        const row = rows.find((candidate) => candidate.tenantId === args.where.tenantId);
        if (row !== undefined) hooks.beforeUpdate?.(row);
        const matches =
          row !== undefined && row.updatedAt.getTime() === args.where.updatedAt.getTime();
        if (matches) {
          row.providerSettings = args.data.providerSettings;
          row.updatedAt = new Date(row.updatedAt.getTime() + 1);
        }
        return Promise.resolve({ count: matches ? 1 : 0 });
      },
    ),
  };
  const tx = {
    merchantPaymentSettings: delegate,
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      scopedTenants.push(values[0]);
      return Promise.resolve(1);
    },
  };
  const prisma = {
    merchantPaymentSettings: delegate,
    $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { prisma, delegate, scopedTenants };
}

const row = (tenantId: string, sealed: string): Row => ({
  tenantId,
  enabledMethods: ["paymob"],
  providerSettings: settings(sealed),
  updatedAt: T0,
});

describe("PrismaPaymentSealedCredentialStore.listRefs (the cross-tenant read)", () => {
  it("pages through every tenant in id order using only ids, never a sealed blob", async () => {
    const { prisma, delegate } = fake([row("t-3", "c"), row("t-1", "a"), row("t-2", "b")]);
    const store = new PrismaPaymentSealedCredentialStore(prisma);
    const first = await store.listRefs(undefined, 2);
    expect(first.map((ref) => ref.tenantId)).toEqual(["t-1", "t-2"]);
    const second = await store.listRefs(first[1]?.key, 2);
    expect(second.map((ref) => ref.tenantId)).toEqual(["t-3"]);
    expect(await store.listRefs("t-3", 2)).toEqual([]);
    for (const call of delegate.findMany.mock.calls) {
      expect(call[0]).toHaveProperty("select", { tenantId: true });
    }
  });
});

describe("PrismaPaymentSealedCredentialStore.resealRow", () => {
  it("rewraps every provider's sealedCredentials, keeps the rest of the row, writes in the tenant's own scope", async () => {
    const rows = [row("t-1", "old-blob")];
    rows[0]!.providerSettings = settings("old-blob", {
      other: { config: { a: 1 }, sealedCredentials: "old-two" },
    });
    const { prisma, scopedTenants } = fake(rows);
    const store = new PrismaPaymentSealedCredentialStore(prisma);
    const outcome = await store.resealRow({ tenantId: "t-1", key: "t-1" }, (sealed) =>
      Promise.resolve(`new(${sealed})`),
    );
    expect(outcome).toBe("resealed");
    expect(rows[0]?.providerSettings).toEqual({
      paymob: { config: { region: "egy" }, sealedCredentials: "new(old-blob)" },
      other: { config: { a: 1 }, sealedCredentials: "new(old-two)" },
    });
    expect(scopedTenants).toEqual(["t-1", "t-1"]); // one scoped read, one scoped write
  });

  it("is unchanged (and writes nothing) when every blob is already current", async () => {
    const { prisma, delegate } = fake([row("t-1", "current")]);
    const outcome = await new PrismaPaymentSealedCredentialStore(prisma).resealRow(
      { tenantId: "t-1", key: "t-1" },
      (sealed) => Promise.resolve(sealed),
    );
    expect(outcome).toBe("unchanged");
    expect(delegate.updateMany).not.toHaveBeenCalled();
  });

  it("compare-and-set: a save that landed after our read makes it a conflict and loses nothing", async () => {
    const rows = [row("t-1", "old-blob")];
    const { prisma } = fake(rows, {
      beforeUpdate: (current) => {
        current.providerSettings = settings("merchant-just-saved");
        current.updatedAt = new Date(T0.getTime() + 5);
      },
    });
    const outcome = await new PrismaPaymentSealedCredentialStore(prisma).resealRow(
      { tenantId: "t-1", key: "t-1" },
      (sealed) => Promise.resolve(`new(${sealed})`),
    );
    expect(outcome).toBe("conflict");
    expect(rows[0]?.providerSettings).toEqual(settings("merchant-just-saved"));
  });

  it("a row that vanished is unchanged; a corrupt row or a failing rewrap throws and writes nothing", async () => {
    const corrupt = row("t-bad", "x");
    corrupt.providerSettings = { paymob: { config: {} } };
    const rows = [row("t-1", "old-blob"), corrupt];
    const { prisma, delegate } = fake(rows);
    const store = new PrismaPaymentSealedCredentialStore(prisma);
    expect(
      await store.resealRow({ tenantId: "t-gone", key: "t-gone" }, (s) => Promise.resolve(s)),
    ).toBe("unchanged");
    await expect(
      store.resealRow({ tenantId: "t-bad", key: "t-bad" }, (s) => Promise.resolve(s)),
    ).rejects.toThrow(/Corrupt merchant payment settings/);
    await expect(
      store.resealRow({ tenantId: "t-1", key: "t-1" }, () =>
        Promise.reject(new Error("could not be opened")),
      ),
    ).rejects.toThrow(/could not be opened/);
    expect(delegate.updateMany).not.toHaveBeenCalled();
    expect(rows[0]?.providerSettings).toEqual(settings("old-blob"));
  });
});
