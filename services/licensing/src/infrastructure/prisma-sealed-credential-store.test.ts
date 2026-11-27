import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaBillingSealedCredentialStore } from "./prisma-sealed-credential-store";

beforeEach(() => {
  expect.hasAssertions();
});

interface Row {
  id: string;
  tenantId: string;
  sealedToken: string | null;
  version: number;
}

const PLATFORM = "tenant-platform";

function fake(rows: Row[], hooks: { beforeUpdate?: (row: Row) => void } = {}) {
  const scopedTenants: unknown[] = [];
  const delegate = {
    findMany: vi.fn(
      (args: {
        where: { sealedToken: { not: null } };
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const sorted = rows
          .filter((row) => row.sealedToken !== null)
          .sort((a, b) => a.id.localeCompare(b.id));
        const start =
          args.cursor === undefined
            ? 0
            : sorted.findIndex((row) => row.id === args.cursor?.id) + (args.skip ?? 0);
        return Promise.resolve(
          sorted
            .slice(start, start + args.take)
            .map((row) => ({ id: row.id, tenantId: row.tenantId })),
        );
      },
    ),
    findFirst: vi.fn((args: { where: { id: string; tenantId: string } }) => {
      const row = rows.find(
        (candidate) => candidate.id === args.where.id && candidate.tenantId === args.where.tenantId,
      );
      return Promise.resolve(row === undefined ? null : { ...row });
    }),
    updateMany: vi.fn(
      (args: {
        where: { id: string; tenantId: string; version: number };
        data: { sealedToken: string; version: { increment: number } };
      }) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === args.where.id && candidate.tenantId === args.where.tenantId,
        );
        if (row !== undefined) hooks.beforeUpdate?.(row);
        const matches = row !== undefined && row.version === args.where.version;
        if (matches) {
          row.sealedToken = args.data.sealedToken;
          row.version += args.data.version.increment;
        }
        return Promise.resolve({ count: matches ? 1 : 0 });
      },
    ),
  };
  const tx = {
    billingPaymentMethod: delegate,
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      scopedTenants.push(values[0]);
      return Promise.resolve(1);
    },
  };
  const prisma = {
    billingPaymentMethod: delegate,
    $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { prisma, delegate, scopedTenants };
}

const method = (id: string, sealedToken: string | null): Row => ({
  id,
  tenantId: PLATFORM,
  sealedToken,
  version: 2,
});

describe("PrismaBillingSealedCredentialStore.listRefs (the cross-tenant read)", () => {
  it("lists only rows that hold a token, in id order, as (tenant, id) pairs", async () => {
    const { prisma, delegate } = fake([
      method("b", "sealed-b"),
      method("a", "sealed-a"),
      method("c", null),
      method("d", "sealed-d"),
    ]);
    const store = new PrismaBillingSealedCredentialStore(prisma);
    const first = await store.listRefs(undefined, 2);
    expect(first).toEqual([
      { tenantId: PLATFORM, key: "a" },
      { tenantId: PLATFORM, key: "b" },
    ]);
    expect(await store.listRefs("b", 2)).toEqual([{ tenantId: PLATFORM, key: "d" }]);
    for (const call of delegate.findMany.mock.calls) {
      expect(call[0]).toHaveProperty("select", { id: true, tenantId: true });
    }
  });
});

describe("PrismaBillingSealedCredentialStore.resealRow", () => {
  const ref = { tenantId: PLATFORM, key: "a" };

  it("rewraps the sealed token inside the row's own tenant scope and bumps the version", async () => {
    const rows = [method("a", "old")];
    const { prisma, scopedTenants } = fake(rows);
    const outcome = await new PrismaBillingSealedCredentialStore(prisma).resealRow(ref, (s) =>
      Promise.resolve(`new(${s})`),
    );
    expect(outcome).toBe("resealed");
    expect(rows[0]).toMatchObject({ sealedToken: "new(old)", version: 3 });
    expect(scopedTenants).toEqual([PLATFORM, PLATFORM]);
  });

  it("is unchanged when the token is current, absent, or the row is gone", async () => {
    const { prisma, delegate } = fake([method("a", "current"), method("n", null)]);
    const store = new PrismaBillingSealedCredentialStore(prisma);
    const same = (s: string): Promise<string> => Promise.resolve(s);
    expect(await store.resealRow(ref, same)).toBe("unchanged");
    expect(await store.resealRow({ tenantId: PLATFORM, key: "n" }, same)).toBe("unchanged");
    expect(await store.resealRow({ tenantId: PLATFORM, key: "zz" }, same)).toBe("unchanged");
    expect(delegate.updateMany).not.toHaveBeenCalled();
  });

  it("compare-and-set on version: a concurrent change is a conflict and nothing is lost", async () => {
    const rows = [method("a", "old")];
    const { prisma } = fake(rows, {
      beforeUpdate: (current) => {
        current.sealedToken = "changed-by-someone-else";
        current.version = 9;
      },
    });
    const outcome = await new PrismaBillingSealedCredentialStore(prisma).resealRow(ref, (s) =>
      Promise.resolve(`new(${s})`),
    );
    expect(outcome).toBe("conflict");
    expect(rows[0]?.sealedToken).toBe("changed-by-someone-else");
  });

  it("a failing rewrap throws and writes nothing", async () => {
    const { prisma, delegate } = fake([method("a", "old")]);
    await expect(
      new PrismaBillingSealedCredentialStore(prisma).resealRow(ref, () =>
        Promise.reject(new Error("could not be opened")),
      ),
    ).rejects.toThrow(/could not be opened/);
    expect(delegate.updateMany).not.toHaveBeenCalled();
  });
});
