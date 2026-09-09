import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-17T00:00:00.000Z") };
const body = <T>(r: { body: unknown }): T => r.body as T;

function wire() {
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    knownSubjects: ["user-1"],
    clock,
  });
}

describe("session intelligence / console explorers / AI governance (end to end)", () => {
  it("surfaces session intelligence, the remaining explorers, and governs AI identities", async () => {
    const app = wire();

    // ── §5 session intelligence: concurrent sessions + an impersonation ──
    await app.security.registerPrincipal({
      externalId: "admin-1",
      kind: "human",
      displayName: "Admin",
      subjectRef: "user-1",
      tenantRef: "t1",
    });
    await app.security.registerPrincipal({
      externalId: "support-1",
      kind: "human",
      displayName: "Support",
      subjectRef: "user-1",
      tenantRef: "t1",
    });
    await app.security.establishSession({
      principalExternalId: "admin-1",
      refreshFingerprint: "rt-a",
      ttlSeconds: 3600,
    });
    await app.security.establishSession({
      principalExternalId: "admin-1",
      refreshFingerprint: "rt-b",
      ttlSeconds: 3600,
    });
    const delegation = await app.security.grantDelegation({
      delegatorExternalId: "admin-1",
      delegateExternalId: "support-1",
      ttlSeconds: 600,
    });
    await app.security.startImpersonation({
      delegationId: body<{ id: string }>(delegation).id,
      refreshFingerprint: "imp-rt",
      ttlSeconds: 300,
    });

    const sessions = await app.security.sessionExplorer();
    expect(sessions.total).toBe(3); // 2 concurrent + 1 impersonation
    expect(sessions.active).toBe(3);
    expect(sessions.impersonations).toBe(1);
    expect(sessions.suspicious).toBeGreaterThanOrEqual(1); // the impersonation is suspicious

    // ── §17 remaining explorers ──
    await app.security.issueCredential({
      principalExternalId: "admin-1",
      kind: "api_key",
      material: "seed",
    });
    const secrets = await app.security.secretExplorer();
    expect(secrets.total).toBeGreaterThanOrEqual(1);
    expect(secrets.credentials.every((c) => !("fingerprint" in c))).toBe(true); // never exposes secret values

    await app.security.definePolicy({ key: "p1", name: "P1", mode: "balanced" });
    await app.security.publishPolicyVersion({ key: "p1", rules: [] });
    const policies = await app.security.policyExplorer();
    expect(policies.policies.find((p) => p.key === "p1")?.activeVersion).toBe(1);

    await app.security.evaluateRisk({ ip: "1.2.3.4" });
    const risk = app.security.riskExplorer();
    expect(risk.total).toBeGreaterThanOrEqual(1);
    expect(risk.dominantBand).not.toBeNull();

    // ── §20 AI security governance ──
    await app.security.registerPrincipal({
      externalId: "ai-agent-1",
      kind: "ai",
      displayName: "Copilot",
      tenantRef: "t1",
    });
    // a human cannot be AI-governed
    expect(
      (await app.security.governAiIdentity({ principalExternalId: "admin-1", config: {} })).status,
    ).toBe(409);
    const governed = await app.security.governAiIdentity({
      principalExternalId: "ai-agent-1",
      config: {
        tokenBudget: 1000,
        callQuota: 5,
        allowedTools: ["search"],
        allowedResources: ["morbeh:catalog:*:*"],
      },
    });
    expect(governed.status).toBe(200);

    // allowed tool + resource + within budget
    const ok = body<{ allowed: boolean }>(
      await app.security.checkAiAction({
        principalExternalId: "ai-agent-1",
        tool: "search",
        resource: "morbeh:catalog:product:p1",
        tokens: 100,
        calls: 1,
      }),
    );
    expect(ok.allowed).toBe(true);
    // forbidden tool (sandbox)
    expect(
      body<{ allowed: boolean }>(
        await app.security.checkAiAction({ principalExternalId: "ai-agent-1", tool: "delete_all" }),
      ).allowed,
    ).toBe(false);
    // forbidden resource (isolation)
    expect(
      body<{ allowed: boolean }>(
        await app.security.checkAiAction({
          principalExternalId: "ai-agent-1",
          resource: "morbeh:finance:ledger:l1",
        }),
      ).allowed,
    ).toBe(false);
    // over budget
    const over = body<{ allowed: boolean; reason?: string }>(
      await app.security.checkAiAction({
        principalExternalId: "ai-agent-1",
        tool: "search",
        tokens: 2000,
        calls: 1,
      }),
    );
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe("token budget exceeded");

    const aiExplorer = await app.security.aiGovernanceExplorer();
    expect(aiExplorer.total).toBe(1);
    expect(aiExplorer.identities[0]?.tokensConsumed).toBe(100);

    // ── canonical events ──
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "security.ai_identity.governed",
        "security.ai_identity.budget_exceeded",
        "security.session.established",
      ]),
    );
  });
});
