import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { NativeTokenIssuer } from "@platform/auth";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { wireAdmin } from "./composition";
import { bootstrapStaffOwner } from "./staff-owner-bootstrap";

const clock: Clock = { now: () => new Date() };

function build() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const lines: string[] = [];
  const logger = {
    debug: () => {},
    info: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
    warn: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
    error: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
  } as never;
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const admin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: new NativeTokenIssuer({
      privateKey,
      issuer: "https://api.test/",
      audience: "morbeh-admin",
      ttlSeconds: 7200,
    }),
  });
  return { admin, logger, lines };
}

describe("bootstrapStaffOwner (Plan 1B-2)", () => {
  it("creates the owner once, who can then sign in as admin; never logs the password", async () => {
    const { admin, logger, lines } = build();
    const input = {
      tenantId: "tenant-local",
      email: "owner@example.test",
      password: "fake-owner-password",
      logger,
    };
    expect(await bootstrapStaffOwner(admin, input)).toBe("created");
    expect(await bootstrapStaffOwner(admin, { ...input, password: "another-fake-password" })).toBe(
      "exists",
    );
    const login = await admin.staffAuth.login({
      tenantId: "tenant-local",
      email: "owner@example.test",
      password: "fake-owner-password",
    });
    expect(login.status).toBe(200);
    expect(lines.join("\n")).not.toContain("fake-owner-password");
  });
});
