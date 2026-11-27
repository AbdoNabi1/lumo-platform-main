import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaShippingSealedCredentialStore } from "./prisma-sealed-credential-store";

beforeEach(() => {
  expect.hasAssertions();
});

interface Row {
  tenantId: string;
  carrierSettings: unknown;
  version: number;
}

const carrier = (creds: string, secret: string, previous?: string): Record<string, unknown> => ({
  config: { cityMode: "auto" },
  sealedCredentials: creds,
  webhook: {
    sealedSecret: secret,
    ...(previous === undefined
      ? {}
      : { previousSealedSecret: previous, previousValidUntil: "2026-12-01T00:00:00.000Z" }),
  },
});

function fake(rows: Row[], hooks: { beforeUpdate?: (row: Row) => void } = {}) {
  const scopedTenants: unknown[] = [];
  const delegate = {
    findMany: vi.fn((args: { take: number; cursor?: { tenantId: string }; skip?: number }) => {
      const sorted = [...rows].sort((a, b) => a.tenantId.localeCompare(b.tenantId));
      const start =
        args.cursor === undefined
          ? 0
          : sorted.findIndex((row) => row.tenantId === args.cursor?.tenantId) + (args.skip ?? 0);
      return Promise.resolve(
        sorted.slice(start, start + args.take).map((row) => ({ tenantId: row.tenantId })),
      );
    }),
    findUnique: vi.fn((args: { where: { tenantId: string } }) => {
      const row = rows.find((candidate) => candidate.tenantId === args.where.tenantId);
      return Promise.resolve(row === undefined ? null : structuredClone(row));
    }),
    updateMany: vi.fn(
      (args: {
        where: { tenantId: string; version: number };
        data: { carrierSettings: unknown; version: { increment: number } };
      }) => {
        const row = rows.find((candidate) => candidate.tenantId === args.where.tenantId);
        if (row !== undefined) hooks.beforeUpdate?.(row);
        const matches = row !== undefined && row.version === args.where.version;
        if (matches) {
          row.carrierSettings = args.data.carrierSettings;
          row.version += args.data.version.increment;
        }
        return Promise.resolve({ count: matches ? 1 : 0 });
      },
    ),
  };
  const tx = {
    merchantCarrierSettings: delegate,
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      scopedTenants.push(values[0]);
      return Promise.resolve(1);
    },
  };
  const prisma = {
    merchantCarrierSettings: delegate,
    $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { prisma, delegate, scopedTenants };
}

describe("PrismaShippingSealedCredentialStore.listRefs (the cross-tenant read)", () => {
  it("pages through every tenant in id order using only ids", async () => {
    const rows: Row[] = ["t-2", "t-1", "t-3"].map((tenantId) => ({
      tenantId,
      carrierSettings: {},
      version: 1,
    }));
    const { prisma, delegate } = fake(rows);
    const store = new PrismaShippingSealedCredentialStore(prisma);
    const first = await store.listRefs(undefined, 2);
    expect(first.map((ref) => ref.tenantId)).toEqual(["t-1", "t-2"]);
    expect((await store.listRefs(first[1]?.key, 2)).map((ref) => ref.tenantId)).toEqual(["t-3"]);
    for (const call of delegate.findMany.mock.calls) {
      expect(call[0]).toHaveProperty("select", { tenantId: true });
    }
  });
});

describe("PrismaShippingSealedCredentialStore.resealRow", () => {
  const ref = { tenantId: "t-1", key: "t-1" };
  const wrap = (sealed: string): Promise<string> => Promise.resolve(`new(${sealed})`);

  it("rewraps the credentials, the webhook secret and the previous webhook secret; keeps the rest", async () => {
    const rows: Row[] = [
      {
        tenantId: "t-1",
        carrierSettings: { bosta: carrier("c-old", "s-old", "p-old") },
        version: 4,
      },
    ];
    const { prisma, scopedTenants } = fake(rows);
    const outcome = await new PrismaShippingSealedCredentialStore(prisma).resealRow(ref, wrap);
    expect(outcome).toBe("resealed");
    expect(rows[0]?.carrierSettings).toEqual({
      bosta: carrier("new(c-old)", "new(s-old)", "new(p-old)"),
    });
    expect(rows[0]?.version).toBe(5);
    expect(scopedTenants).toEqual(["t-1", "t-1"]);
  });

  it("handles a carrier without a previous webhook secret", async () => {
    const rows: Row[] = [
      { tenantId: "t-1", carrierSettings: { bosta: carrier("c-old", "s-old") }, version: 1 },
    ];
    const { prisma } = fake(rows);
    await new PrismaShippingSealedCredentialStore(prisma).resealRow(ref, wrap);
    expect(rows[0]?.carrierSettings).toEqual({ bosta: carrier("new(c-old)", "new(s-old)") });
  });

  it("is unchanged and writes nothing when every blob is already current", async () => {
    const rows: Row[] = [
      { tenantId: "t-1", carrierSettings: { bosta: carrier("c", "s", "p") }, version: 1 },
    ];
    const { prisma, delegate } = fake(rows);
    const outcome = await new PrismaShippingSealedCredentialStore(prisma).resealRow(ref, (s) =>
      Promise.resolve(s),
    );
    expect(outcome).toBe("unchanged");
    expect(delegate.updateMany).not.toHaveBeenCalled();
  });

  it("compare-and-set on version: a concurrent save makes it a conflict and loses nothing", async () => {
    const rows: Row[] = [
      { tenantId: "t-1", carrierSettings: { bosta: carrier("c-old", "s-old") }, version: 1 },
    ];
    const { prisma } = fake(rows, {
      beforeUpdate: (current) => {
        current.carrierSettings = { bosta: carrier("merchant-saved", "s-old") };
        current.version = 2;
      },
    });
    const outcome = await new PrismaShippingSealedCredentialStore(prisma).resealRow(ref, wrap);
    expect(outcome).toBe("conflict");
    expect(rows[0]?.carrierSettings).toEqual({ bosta: carrier("merchant-saved", "s-old") });
  });

  it("a missing row is unchanged; a corrupt row or a failing rewrap throws and writes nothing", async () => {
    const rows: Row[] = [
      { tenantId: "t-1", carrierSettings: { bosta: carrier("c-old", "s-old") }, version: 1 },
      { tenantId: "t-bad", carrierSettings: { bosta: { config: {} } }, version: 1 },
    ];
    const { prisma, delegate } = fake(rows);
    const store = new PrismaShippingSealedCredentialStore(prisma);
    expect(await store.resealRow({ tenantId: "t-gone", key: "t-gone" }, wrap)).toBe("unchanged");
    await expect(store.resealRow({ tenantId: "t-bad", key: "t-bad" }, wrap)).rejects.toThrow(
      /Corrupt merchant carrier settings/,
    );
    await expect(
      store.resealRow(ref, () => Promise.reject(new Error("could not be opened"))),
    ).rejects.toThrow(/could not be opened/);
    expect(delegate.updateMany).not.toHaveBeenCalled();
  });
});
