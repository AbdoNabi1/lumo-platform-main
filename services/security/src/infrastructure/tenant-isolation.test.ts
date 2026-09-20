import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import {
  assertWriteTimeTenant,
  CapturingOutboxWriter,
  tenantRowIsolationCases,
  type TenantRowIsolationFixture,
  type TenantRowStore,
} from "@platform/messaging/testing";
import { Principal } from "../domain/principal";
import type { PrincipalDirectory, PrincipalRepository } from "../domain/repositories";
import { InMemoryConsentProjectionStore, ProjectionConsentPort } from "./consent-projection";
import { InMemoryIdentityProjectionStore } from "./identity-projection";
import {
  InMemoryAuditLedgerRepository,
  InMemoryPrincipalRepository,
  InMemoryRoleRepository,
} from "./in-memory-repositories";
import { PrismaPrincipalRepository } from "./prisma-repositories";
import { SecurityEventTranslator } from "./security-event-translator";

/** ADR-0014 (WP-10, T10.3): one Security repository serves every tenant. */
const context = rootEventContext({ generate: () => "evt-x" });

function inMemoryRepos(outbox?: OutboxWriter) {
  const writer =
    outbox ??
    new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new SecurityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "security",
    });
  return { outbox: writer, context };
}

function newPrincipal(externalId: string): Principal {
  return Principal.register(
    UniqueEntityId.from(`p-${externalId}`),
    { externalId, kind: "service_account", displayName: externalId },
    "evt-1",
    new Date(0),
  );
}

describe("security tenant isolation (ADR-0014)", () => {
  it("does not let one tenant's role key or audit chain leak into another's", async () => {
    const roles = new InMemoryRoleRepository(inMemoryRepos());
    const { Role } = await import("../domain/role");
    const role = Role.define(
      UniqueEntityId.from("r-1"),
      { key: "admin", name: "Admin", permissions: ["*:*"] },
      "evt-1",
      new Date(0),
    );
    await roles.save(role, "tenant-a");
    expect(await roles.findByKey("admin", "tenant-b")).toBeNull();
    expect(await roles.findByKeys(["admin"], "tenant-b")).toHaveLength(0);

    const ledger = new InMemoryAuditLedgerRepository();
    expect(await ledger.tail(null, "tenant-a")).toBeNull();
    expect(await ledger.list(null, "tenant-b")).toHaveLength(0);
  });

  it("scopes the identity and consent projections by the per-call tenant", async () => {
    const identity = new InMemoryIdentityProjectionStore();
    await identity.upsertUser(
      { userId: "u1", userTenant: "t1", status: "active", occurredAt: "2026-07-18T00:00:00.000Z" },
      "tenant-a",
    );
    expect(await identity.getUser("u1", "tenant-a")).not.toBeNull();
    expect(await identity.getUser("u1", "tenant-b")).toBeNull();

    const consent = new InMemoryConsentProjectionStore();
    await consent.upsert(
      {
        subjectRef: "c1",
        purpose: "marketing",
        granted: true,
        occurredAt: "2026-07-18T00:00:00.000Z",
      },
      "tenant-a",
    );
    const port = new ProjectionConsentPort(consent);
    expect(await port.hasConsent("c1", "marketing", "tenant-a")).toBe(true);
    expect(await port.hasConsent("c1", "marketing", "tenant-b")).toBe(false);
  });

  it("merges the per-call tenantId into the outbox event context at write time (in-memory)", async () => {
    await assertWriteTimeTenant("security (in-memory)", async (outbox, tenantId) => {
      await new InMemoryPrincipalRepository(inMemoryRepos(outbox)).save(
        newPrincipal("svc-1"),
        tenantId,
      );
    });
  });

  it("merges the per-call tenantId into the outbox event context at write time (Prisma)", async () => {
    await assertWriteTimeTenant("security (prisma)", async (outbox, tenantId) => {
      const tx = {
        securityPrincipal: { create: async () => ({}) },
      } as unknown as TransactionClient;
      const repo = new PrismaPrincipalRepository({
        prisma: {} as never,
        outbox: outbox as never,
        context,
      });
      await repo.save(newPrincipal("svc-1"), tenantId, tx);
    });
  });
});

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// Principals are the identity the authorization model is built on: a cross-tenant leak here is a
// cross-tenant identity leak. Both adapters run; the Prisma one over a fake that applies `where`
// literally, so it cannot pass because of RLS.
function principalStore(
  repo: PrincipalRepository & PrincipalDirectory,
  tx: () => unknown,
): TenantRowStore {
  const forged = (key: string, marker: string) =>
    Principal.reconstitute(UniqueEntityId.from(`p-${key}`), {
      externalId: key,
      kind: "service_account",
      displayName: marker,
      subjectRef: null,
      tenantRef: null,
      status: "active",
      attributes: {},
      version: 1,
    });
  return {
    insert: async (tenantId, key, marker) => {
      const principal = Principal.register(
        UniqueEntityId.from(`p-${key}`),
        { externalId: key, kind: "service_account", displayName: marker },
        "evt-1",
        new Date(0),
      );
      await repo.save(principal, tenantId, tx());
    },
    find: async (tenantId, key) =>
      (await repo.findByExternalId(key, tenantId, tx()))?.displayName ?? null,
    list: async (tenantId) =>
      (await repo.listAll(tenantId, tx())).map((principal) => principal.displayName),
    // Forged aggregate: the victim's id, submitted under the attacker's tenant.
    update: (tenantId, key, marker) => repo.save(forged(key, marker), tenantId, tx()),
  };
}

describe("security principal tenant isolation (T10.5)", () => {
  const fixtures: TenantRowIsolationFixture[] = [
    {
      context: "security/principal",
      layer: "in-memory adapter",
      make: () => principalStore(new InMemoryPrincipalRepository(inMemoryRepos()), () => undefined),
    },
    {
      context: "security/principal",
      layer: "prisma repository over fake-prisma (app-layer where, no RLS)",
      make: () => {
        const fake = createFakePrisma();
        return principalStore(
          new PrismaPrincipalRepository({
            prisma: fake.database,
            outbox: new CapturingOutboxWriter() as never,
            context,
          }),
          () => fake.database,
        );
      },
    },
  ];
  for (const fixture of fixtures)
    for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
});
