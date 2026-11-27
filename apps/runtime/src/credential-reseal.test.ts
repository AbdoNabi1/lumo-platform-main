import type { Database } from "@platform/db";
import { HealthRegistry } from "@platform/health";
import { EnvelopePaymentCredentialVault } from "@platform/payments";
import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { NodeCrypto } from "@platform/security";
import type { Logger } from "@platform/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runCredentialReseal,
  startCredentialReseal,
  type CredentialResealPlan,
  type ResealLock,
  type SealedCredentialStore,
  type SealedRowRef,
} from "./credential-reseal";

beforeEach(() => {
  expect.hasAssertions();
});

const KEK_A = "kek-test-aaaa".padEnd(40, "a");
const KEK_B = "kek-test-bbbb".padEnd(40, "b");
const KEK_ATTACKER = "kek-test-attacker".padEnd(40, "x");
const ALIAS = "payments-credentials";

function vaultWith(...refsOldestFirst: string[]): EnvelopePaymentCredentialVault {
  const aliases = new KeyAliasRegistry();
  for (const ref of refsOldestFirst) aliases.set(ALIAS, ref);
  return new EnvelopePaymentCredentialVault(new EnvelopeCipher(new NodeCrypto(), aliases), ALIAS);
}

/** A row exactly as v1 stored it: the key reference sat next to the ciphertext. */
async function legacyV1(kekRef: string, tenantId: string): Promise<string> {
  const crypto = new NodeCrypto();
  const dek = await crypto.randomToken(32);
  return JSON.stringify({
    v: 1,
    alias: ALIAS,
    kekRef,
    wrappedDek: await crypto.wrapKey(dek, kekRef),
    ciphertext: await crypto.encrypt(
      JSON.stringify({ v: 1, t: tenantId, p: "paymob", s: { secretKey: "sk-test-1111" } }),
      dek,
    ),
  });
}

/** An in-memory store: one sealed blob per row, compare-and-set like the Prisma ones. */
class MemoryStore implements SealedCredentialStore {
  readonly rows = new Map<string, { tenantId: string; sealed: string; version: number }>();
  /** Lets a test play "a merchant saved in between": runs once, right before the write. */
  beforeWrite: ((key: string) => void) | undefined;
  failList = false;
  writes = 0;

  constructor(readonly name: string) {}

  add(key: string, sealed: string): void {
    this.rows.set(key, { tenantId: `tenant-of-${key}`, sealed, version: 1 });
  }

  listRefs(after: string | undefined, limit: number): Promise<readonly SealedRowRef[]> {
    if (this.failList) return Promise.reject(new Error("db down: secret-detail"));
    const keys = [...this.rows.keys()].sort().filter((key) => after === undefined || key > after);
    return Promise.resolve(
      keys.slice(0, limit).map((key) => ({ tenantId: `tenant-of-${key}`, key })),
    );
  }

  async resealRow(
    ref: SealedRowRef,
    rewrap: (sealed: string) => Promise<string>,
  ): Promise<"resealed" | "unchanged" | "conflict"> {
    const row = this.rows.get(ref.key);
    if (row === undefined) return "unchanged";
    const seenVersion = row.version;
    const next = await rewrap(row.sealed);
    if (next === row.sealed) return "unchanged";
    const hook = this.beforeWrite;
    this.beforeWrite = undefined;
    hook?.(ref.key);
    if (row.version !== seenVersion) return "conflict";
    row.sealed = next;
    row.version += 1;
    this.writes += 1;
    return "resealed";
  }
}

function silentLogger(): Logger & {
  lines: { level: string; message: string; fields?: unknown }[];
} {
  const lines: { level: string; message: string; fields?: unknown }[] = [];
  const log =
    (level: string) =>
    (message: string, fields?: unknown): void => {
      lines.push({ level, message, fields });
    };
  const self = {
    lines,
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: () => self,
  };
  return self as unknown as Logger & { lines: typeof lines };
}

const freeLock: ResealLock = {
  runExclusive: async (fn) => ({ acquired: true, value: await fn() }),
};

function planOf(
  store: SealedCredentialStore,
  vault: EnvelopePaymentCredentialVault,
): CredentialResealPlan {
  return { targets: [{ name: store.name, store, rewrap: (sealed) => vault.reseal(sealed) }] };
}

describe("runCredentialReseal (D55)", () => {
  it("re-seals v1 and previous-key rows under the current key; afterwards the previous key can be deleted", async () => {
    const store = new MemoryStore("payments");
    store.add(
      "t-1",
      await vaultWith(KEK_A).seal("tenant-of-t-1", "paymob", { secretKey: "sk-test-1111" }),
    );
    store.add("t-2", await legacyV1(KEK_A, "tenant-of-t-2"));
    const logger = silentLogger();

    const result = await runCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      lock: freeLock,
      logger,
    });

    expect(result).toEqual({
      ran: true,
      report: { payments: { resealed: 2, skipped: 0, failed: 0 } },
    });
    // The previous key is no longer needed: a vault that only knows the CURRENT key opens everything.
    const currentOnly = vaultWith(KEK_B);
    for (const [key, row] of store.rows) {
      expect(await currentOnly.open(`tenant-of-${key}`, "paymob", row.sealed)).toEqual({
        secretKey: "sk-test-1111",
      });
      expect(row.sealed).not.toContain("kekRef");
    }
  });

  it("is idempotent: a second run skips every row (already v2 under the current key) and writes nothing", async () => {
    const store = new MemoryStore("payments");
    store.add("t-1", await legacyV1(KEK_A, "tenant-of-t-1"));
    const plan = planOf(store, vaultWith(KEK_A, KEK_B));
    await runCredentialReseal({ plan, lock: freeLock, logger: silentLogger() });
    const writesAfterFirst = store.writes;
    const second = await runCredentialReseal({ plan, lock: freeLock, logger: silentLogger() });
    expect(second).toEqual({
      ran: true,
      report: { payments: { resealed: 0, skipped: 1, failed: 0 } },
    });
    expect(store.writes).toBe(writesAfterFirst);
  });

  it("logs counts only: one summary line, no id, key, blob or error text", async () => {
    const store = new MemoryStore("payments");
    store.add(
      "t-good",
      await vaultWith(KEK_A).seal("tenant-of-t-good", "paymob", { secretKey: "sk-test-1111" }),
    );
    store.add("t-attacker", await legacyV1(KEK_ATTACKER, "tenant-of-t-attacker"));
    const logger = silentLogger();
    await runCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      lock: freeLock,
      logger,
    });

    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]?.level).toBe("warn");
    expect(logger.lines[0]?.message).toBe("credential reseal: resealed 1, skipped 0, failed 1");
    const everything = JSON.stringify(logger.lines);
    for (const forbidden of [
      "t-good",
      "t-attacker",
      "tenant-of",
      KEK_A,
      KEK_B,
      KEK_ATTACKER,
      "sk-test-1111",
      ...[...store.rows.values()].map((row) => row.sealed),
      "could not be opened",
    ]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("a row nobody can open counts as failed, is left untouched, and does not stop the others", async () => {
    const store = new MemoryStore("payments");
    const hostile = await legacyV1(KEK_ATTACKER, "tenant-of-a");
    store.add("a", hostile);
    store.add("b", await legacyV1(KEK_A, "tenant-of-b"));
    const result = await runCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      lock: freeLock,
      logger: silentLogger(),
    });
    expect(result).toEqual({
      ran: true,
      report: { payments: { resealed: 1, skipped: 0, failed: 1 } },
    });
    expect(store.rows.get("a")?.sealed).toBe(hostile);
  });

  it("compare-and-set: a save that lands mid-run is retried from a fresh read and never overwritten", async () => {
    const store = new MemoryStore("payments");
    store.add("t-1", await legacyV1(KEK_A, "tenant-of-t-1"));
    store.beforeWrite = (key) => {
      const row = store.rows.get(key);
      if (row !== undefined) row.version += 1; // a concurrent save
    };
    const result = await runCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      lock: freeLock,
      logger: silentLogger(),
    });
    expect(result).toEqual({
      ran: true,
      report: { payments: { resealed: 1, skipped: 0, failed: 0 } },
    });
  });

  it("a row that keeps changing underneath us is failed after maxAttempts, not looped forever", async () => {
    const store = new MemoryStore("payments");
    store.add("t-1", await legacyV1(KEK_A, "tenant-of-t-1"));
    const attempts = vi.fn(() => Promise.resolve("conflict" as const));
    store.resealRow = attempts;
    const result = await runCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      lock: freeLock,
      logger: silentLogger(),
      maxAttempts: 3,
    });
    expect(attempts).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      ran: true,
      report: { payments: { resealed: 0, skipped: 0, failed: 1 } },
    });
  });

  it("visits every page of rows", async () => {
    const store = new MemoryStore("payments");
    const sealed = await vaultWith(KEK_B).seal("tenant-of-r", "paymob", {
      secretKey: "sk-test-1111",
    });
    for (const key of ["a", "b", "c", "d", "e"]) store.add(key, sealed);
    const result = await runCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      lock: freeLock,
      logger: silentLogger(),
      pageSize: 2,
    });
    expect(result).toEqual({
      ran: true,
      report: { payments: { resealed: 0, skipped: 5, failed: 0 } },
    });
  });

  it("an unreachable table is one failure for that target; the other targets still run", async () => {
    const broken = new MemoryStore("payments");
    broken.failList = true;
    const healthy = new MemoryStore("shipping");
    healthy.add("t-1", await legacyV1(KEK_A, "tenant-of-t-1"));
    const vault = vaultWith(KEK_A, KEK_B);
    const logger = silentLogger();
    const result = await runCredentialReseal({
      plan: {
        targets: [
          { name: "payments", store: broken, rewrap: (s) => vault.reseal(s) },
          { name: "shipping", store: healthy, rewrap: (s) => vault.reseal(s) },
        ],
      },
      lock: freeLock,
      logger,
    });
    expect(result).toEqual({
      ran: true,
      report: {
        payments: { resealed: 0, skipped: 0, failed: 1 },
        shipping: { resealed: 1, skipped: 0, failed: 0 },
      },
    });
    expect(JSON.stringify(logger.lines)).not.toContain("secret-detail");
  });

  it("another replica holding the lock: nothing is read or written, and the run says so", async () => {
    const store = new MemoryStore("payments");
    store.add("t-1", await legacyV1(KEK_A, "tenant-of-t-1"));
    const listRefs = vi.spyOn(store, "listRefs");
    const logger = silentLogger();
    const result = await runCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      lock: { runExclusive: () => Promise.resolve({ acquired: false }) },
      logger,
    });
    expect(result).toEqual({ ran: false });
    expect(listRefs).not.toHaveBeenCalled();
    expect(store.writes).toBe(0);
  });

  it("only one of two concurrent replicas does the work (lock honoured, one run at a time)", async () => {
    const store = new MemoryStore("payments");
    store.add("t-1", await legacyV1(KEK_A, "tenant-of-t-1"));
    let held = false;
    const exclusive: ResealLock = {
      runExclusive: async (fn) => {
        if (held) return { acquired: false };
        held = true;
        try {
          return { acquired: true, value: await fn() };
        } finally {
          held = false;
        }
      },
    };
    const plan = planOf(store, vaultWith(KEK_A, KEK_B));
    const [one, two] = await Promise.all([
      runCredentialReseal({ plan, lock: exclusive, logger: silentLogger() }),
      runCredentialReseal({ plan, lock: exclusive, logger: silentLogger() }),
    ]);
    expect([one.ran, two.ran].sort()).toEqual([false, true]);
    expect(store.writes).toBe(1);
  });
});

describe("startCredentialReseal (background start + readiness counts)", () => {
  const prisma = {} as Database;

  it("does nothing, and registers no probe, without a rotation plan", () => {
    const health = new HealthRegistry();
    const register = vi.spyOn(health, "register");
    expect(
      startCredentialReseal({
        plan: undefined,
        prisma,
        health,
        logger: silentLogger(),
        lock: freeLock,
      }),
    ).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it("runs in the background and its probe reports degraded, with counts only, while any row failed", async () => {
    const store = new MemoryStore("payments");
    store.add("a", await legacyV1(KEK_ATTACKER, "tenant-of-a"));
    store.add("b", await legacyV1(KEK_A, "tenant-of-b"));
    const health = new HealthRegistry();
    const run = startCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      prisma,
      health,
      logger: silentLogger(),
      lock: freeLock,
    });
    await run;
    const report = await health.run();
    const component = report.components.find((c) => c.name === "credential-reseal");
    expect(component?.status).toBe("degraded");
    expect(component?.error).toBe("credential reseal: resealed 1, skipped 0, failed 1");
  });

  it("is healthy once a run finishes with no failures", async () => {
    const store = new MemoryStore("payments");
    store.add("b", await legacyV1(KEK_A, "tenant-of-b"));
    const health = new HealthRegistry();
    await startCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      prisma,
      health,
      logger: silentLogger(),
      lock: freeLock,
    });
    const report = await health.run();
    expect(report.components.find((c) => c.name === "credential-reseal")?.status).toBe("healthy");
  });

  it("a lock that throws never escapes the background promise and is reported as one failure", async () => {
    const logger = silentLogger();
    const health = new HealthRegistry();
    const store = new MemoryStore("payments");
    const result = await startCredentialReseal({
      plan: planOf(store, vaultWith(KEK_A, KEK_B)),
      prisma,
      health,
      logger,
      lock: { runExclusive: () => Promise.reject(new Error("connection string secret-detail")) },
    });
    expect(result).toEqual({ ran: false });
    expect(logger.lines.map((l) => l.message)).toEqual([
      "credential reseal: run did not complete, resealed 0, skipped 0, failed 1",
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain("secret-detail");
  });
});
