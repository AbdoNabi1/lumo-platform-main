import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";
import { wireAdPlatforms } from "./composition";
import { InMemoryCredentialVault } from "./infrastructure/in-memory-credential-vault";
import { EnvelopeCredentialVault } from "./infrastructure/envelope-credential-vault";
import { testEnvelopeVault } from "./testing/local-key-wrap-cipher";

beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-11-23T10:00:00.000Z");
const SECRET = "EAAB1234567890abcd";
const META = { platform: "meta", pixelId: "123456789012345" };
const clock = { now: () => NOW };
const ids = { generate: () => "01930000-0000-7000-8000-000000000001" };

interface Call {
  model: string;
  method: string;
  args: unknown;
}

/** A recording Prisma stand-in: every delegate call and `$executeRaw` is recorded; reads find nothing; writes succeed. */
function recordingPrisma() {
  const calls: Call[] = [];
  const delegate = new Proxy(
    {},
    {
      get: (_target, method: string) => (args: unknown) => {
        calls.push({ model: "adPlatformConnection", method, args });
        if (method === "findMany") return Promise.resolve([]);
        if (method === "updateMany") return Promise.resolve({ count: 1 });
        return Promise.resolve(null);
      },
    },
  );
  const client: Record<string, unknown> = {
    adPlatformConnection: delegate,
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ model: "$raw", method: "executeRaw", args: values[0] });
      return Promise.resolve(1);
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return { prisma: client as unknown as Database, calls };
}

const request = {
  tenantId: "t-1",
  platform: "meta" as const,
  enabled: true,
  publicConfig: META,
  secret: SECRET,
  expectedVersion: 0,
};

describe("wireAdPlatforms — Prisma branch", () => {
  const savedNodeEnv = process.env["NODE_ENV"];
  beforeEach(() => {
    // The policy must not depend on the environment: run with NODE_ENV unset.
    delete process.env["NODE_ENV"];
    return () => {
      if (savedNodeEnv !== undefined) process.env["NODE_ENV"] = savedNodeEnv;
    };
  });

  it("with no real vault, a token is refused with 503 UNAVAILABLE and nothing is stored (NODE_ENV unset)", async () => {
    expect(process.env["NODE_ENV"]).toBeUndefined();
    const { prisma, calls } = recordingPrisma();
    const wired = wireAdPlatforms({ clock, idGenerator: ids, prisma });
    const response = await wired.controller.save(request);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain(SECRET);
    expect(JSON.stringify(response.body)).toContain(
      "ad platform credential storage is not configured",
    );
    expect(calls).toEqual([]);
  });

  it("an explicit stub vault is refused the same way, whatever the environment", async () => {
    const { prisma, calls } = recordingPrisma();
    const wired = wireAdPlatforms({
      clock,
      idGenerator: ids,
      prisma,
      vault: new InMemoryCredentialVault(),
    });
    expect((await wired.controller.save(request)).status).toBe(503);
    expect(calls).toEqual([]);
  });

  it("with no real vault, public ids still save (no secret ⇒ 200) through the Prisma repository", async () => {
    const { prisma, calls } = recordingPrisma();
    const wired = wireAdPlatforms({ clock, idGenerator: ids, prisma });
    const response = await wired.controller.save({ ...request, secret: "" });
    expect(response.status).toBe(200);
    const create = calls.find((c) => c.method === "create");
    expect(
      (create?.args as { data: { sealedSecret: unknown; platform: string } }).data,
    ).toMatchObject({
      platform: "meta",
      sealedSecret: null,
    });
  });

  it("with the envelope vault the token is sealed into the stored row (an envelope, not the plaintext)", async () => {
    const { prisma, calls } = recordingPrisma();
    const vault = testEnvelopeVault();
    expect(vault).toBeInstanceOf(EnvelopeCredentialVault);
    const wired = wireAdPlatforms({ clock, idGenerator: ids, prisma, vault });
    const response = await wired.controller.save(request);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(SECRET);
    const create = calls.find((c) => c.method === "create");
    const sealed = (create?.args as { data: { sealedSecret: string } }).data.sealedSecret;
    expect(sealed).not.toContain(SECRET);
    expect(Object.keys(JSON.parse(sealed) as object).sort()).toEqual([
      "alias",
      "ciphertext",
      "kekRef",
      "v",
      "wrappedDek",
    ]);
    expect(await vault.open("t-1", "meta", sealed)).toBe(SECRET);
  });

  it("an explicit allow_stub policy still overrides the Prisma default (the caller owns that choice)", async () => {
    const { prisma, calls } = recordingPrisma();
    const wired = wireAdPlatforms({
      clock,
      idGenerator: ids,
      prisma,
      credentialPolicy: "allow_stub",
    });
    expect((await wired.controller.save(request)).status).toBe(200);
    expect(calls.some((c) => c.method === "create")).toBe(true);
  });

  it("builds a Prisma-backed controller whose reads are tenant-scoped", async () => {
    const { prisma, calls } = recordingPrisma();
    const wired = wireAdPlatforms({ clock, idGenerator: ids, prisma });
    expect((await wired.controller.list({ tenantId: "t-7" })).status).toBe(200);
    expect(calls[0]).toEqual({ model: "$raw", method: "executeRaw", args: "t-7" });
    expect(calls[1]?.args).toEqual({ where: { tenantId: "t-7" }, orderBy: { platform: "asc" } });
  });
});

describe("wireAdPlatforms — in-memory branch", () => {
  it("keeps allow_stub as its default (nothing changes for the in-memory composition)", async () => {
    const wired = wireAdPlatforms({ clock, idGenerator: ids });
    expect((await wired.controller.save(request)).status).toBe(200);
  });
});
