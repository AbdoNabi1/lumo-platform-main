import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import type { IntegrationEvent } from "@platform/domain-events";
import { JsonEventSerializer } from "@platform/domain-events";
import { SystemClock } from "@platform/clock";
import { CryptoIdGenerator } from "@platform/id";
import { logger } from "@platform/utils";
import { wireSecurity, type WiredSecurity } from "@platform/security";
import { bootstrapSecurity } from "./bootstrap-security";
import {
  AssignRoleOnMembershipCreated,
  ProvisionPrincipalOnUserCreated,
} from "./security-provisioning.consumers";
import { wireSecurityEdge } from "./wire-security-edge";
import type { SecurityPermissionGuard } from "./edge-middleware";

/**
 * P2.0.3 — **external session federation** (ADR-0031), the last code-level half of zero-trust enforcement.
 *
 * P2.0.2 left human enforcement gated: `EvaluateAccess` resolves a session by its *internal* id, but a
 * request only carries the *upstream* IdP session id (Kratos `sid`), and nothing bound the two — so every
 * human failed closed. These tests exercise the real guard → federation → `EvaluateAccess` chain to prove
 * the binding now works **and** that it stayed strict: a mirror is never re-bound to another principal and
 * never resurrected after revocation.
 *
 * Offline, but not a mock: the same runtime wiring the api process builds (`bootstrapSecurity`, the
 * provisioning consumers, `wireSecurityEdge` → `SecurityPermissionGuard` with the SDK as federator), with
 * the context's in-memory slice standing in for Postgres. Live Kratos is only the *source* of the `sid`;
 * the binding logic under test is entirely ours.
 */
const HUMAN_USER = "user-human-1";
const OTHER_USER = "user-human-2";
const TENANT = "tenant-local";
const DEVICE = "device-trusted-1";
const KRATOS_SID = "kratos-session-abc";

function makeEvent<T>(type: string, payload: T): IntegrationEvent<T> {
  return {
    messageId: `msg-${type}-${JSON.stringify(payload)}`,
    type,
    eventVersion: 1,
    aggregateId: "agg-1",
    aggregateType: "user",
    occurredAt: new Date("2026-07-19T00:00:00.000Z").toISOString(),
    correlationId: "corr-1",
    causationId: "cause-1",
    tenantId: TENANT,
    payload,
    metadata: {},
  };
}

describe("P2.0.3 external session federation — human zero-trust enforcement", () => {
  let wired: WiredSecurity;
  /** The production shape: SDK as decider AND as session federator. */
  let guard: SecurityPermissionGuard;
  /** The P2.0.2 shape (no federator) — the control proving federation is what closes the gap. */
  let unfederatedGuard: SecurityPermissionGuard;

  async function provision(userId: string): Promise<void> {
    const deps = { security: wired.security, logger };
    await new ProvisionPrincipalOnUserCreated(deps).handle(
      makeEvent("identity.user.created", { userId, tenantId: TENANT }),
    );
    await new AssignRoleOnMembershipCreated(deps).handle(
      makeEvent("identity.membership.created", {
        membershipId: `m-${userId}`,
        userId,
        organizationId: "org-1",
        role: "admin",
      }),
    );
  }

  beforeEach(async () => {
    wired = wireSecurity({
      serializer: new JsonEventSerializer(),
      idGenerator: new CryptoIdGenerator(),
      clock: new SystemClock(),
      knownSubjects: [HUMAN_USER, OTHER_USER],
      trustedDevices: [DEVICE],
    });
    await bootstrapSecurity(wired.security, TENANT, logger);
    const edge = wireSecurityEdge({ logger });
    guard = edge.buildGuard(wired.sdk, undefined, wired.sdk);
    unfederatedGuard = edge.buildGuard(wired.sdk);
  });

  it("ALLOWS a human carrying only a Kratos sid — the mirror is established on first sight", async () => {
    await provision(HUMAN_USER);
    const principal: Principal = { id: HUMAN_USER, kind: "staff", roles: [], tenantId: TENANT };

    // No Security session exists; the request carries only the upstream sid.
    const denied = await guard.ensure(principal, "orders:read", {
      tenantId: TENANT,
      sessionId: KRATOS_SID,
      deviceRef: DEVICE,
      ip: "203.0.113.7",
    });
    expect(denied).toBeNull(); // null ⇒ allowed

    // A mirror now exists, bound to the upstream id.
    const explorer = await wired.security.sessionExplorer(TENANT);
    const mirror = explorer.sessions.find((s) => s.externalRef === KRATOS_SID);
    expect(mirror?.status).toBe("active");
    expect(wired.telemetry.snapshot()["security.session.federated"]).toBe(1);
  });

  it("is the missing half: the same request without a federator fails closed (P2.0.2 behaviour)", async () => {
    await provision(HUMAN_USER);
    const principal: Principal = { id: HUMAN_USER, kind: "staff", roles: [], tenantId: TENANT };

    const denied = await unfederatedGuard.ensure(principal, "orders:read", {
      tenantId: TENANT,
      sessionId: KRATOS_SID,
      deviceRef: DEVICE,
    });
    expect(denied?.status).toBe(403);
    expect(JSON.stringify(denied?.body)).toContain("no valid session");
  });

  it("federates idempotently — repeated requests reuse the one mirror, they do not mint sessions", async () => {
    await provision(HUMAN_USER);
    const principal: Principal = { id: HUMAN_USER, kind: "staff", roles: [], tenantId: TENANT };

    for (let i = 0; i < 3; i += 1) {
      const denied = await guard.ensure(principal, "orders:read", {
        tenantId: TENANT,
        sessionId: KRATOS_SID,
        deviceRef: DEVICE,
      });
      expect(denied).toBeNull();
    }

    const explorer = await wired.security.sessionExplorer(TENANT);
    expect(explorer.sessions.filter((s) => s.externalRef === KRATOS_SID)).toHaveLength(1);
    // Establishment happened once; the other two requests resolved the existing mirror.
    expect(wired.telemetry.snapshot()["security.session.federated"]).toBe(1);
  });

  it("refuses to resurrect a REVOKED mirror — revocation actually holds against a replayed sid", async () => {
    await provision(HUMAN_USER);
    const principal: Principal = { id: HUMAN_USER, kind: "staff", roles: [], tenantId: TENANT };
    expect(
      await guard.ensure(principal, "orders:read", {
        tenantId: TENANT,
        sessionId: KRATOS_SID,
        deviceRef: DEVICE,
      }),
    ).toBeNull();

    // Revoke the mirror (the "logout everywhere" / compromise path), then replay the same sid.
    const explorer = await wired.security.sessionExplorer(TENANT);
    const mirrorId = explorer.sessions.find((s) => s.externalRef === KRATOS_SID)?.id ?? "";
    expect(mirrorId).not.toBe("");
    const revoked = await wired.security.revokeSession({
      tenantId: TENANT,
      sessionId: mirrorId,
    });
    expect(revoked.status).toBeLessThan(300);

    const denied = await guard.ensure(principal, "orders:read", {
      tenantId: TENANT,
      sessionId: KRATOS_SID,
      deviceRef: DEVICE,
    });
    expect(denied?.status).toBe(403);
    // Refused rather than re-established: still exactly one mirror for that sid.
    const after = await wired.security.sessionExplorer(TENANT);
    expect(after.sessions.filter((s) => s.externalRef === KRATOS_SID)).toHaveLength(1);
    expect(wired.telemetry.snapshot()["security.session.federation_rejected"]).toBeGreaterThan(0);
  });

  it("never re-binds a sid to a different principal (session-fixation defence)", async () => {
    await provision(HUMAN_USER);
    await provision(OTHER_USER);
    expect(
      await guard.ensure(
        { id: HUMAN_USER, kind: "staff", roles: [], tenantId: TENANT },
        "orders:read",
        {
          tenantId: TENANT,
          sessionId: KRATOS_SID,
          deviceRef: DEVICE,
        },
      ),
    ).toBeNull();

    // A second principal presenting the first principal's sid gets no session → fail-closed deny.
    const denied = await guard.ensure(
      { id: OTHER_USER, kind: "staff", roles: [], tenantId: TENANT },
      "orders:read",
      {
        tenantId: TENANT,
        sessionId: KRATOS_SID,
        deviceRef: DEVICE,
      },
    );
    expect(denied?.status).toBe(403);
    expect(JSON.stringify(denied?.body)).toContain("no valid session");
  });

  it("refuses federation for an unprovisioned principal (no principal ⇒ no session ⇒ deny)", async () => {
    const outcome = await wired.sdk.federateSession({
      tenantId: TENANT,
      principalExternalId: "user-never-provisioned",
      externalRef: "kratos-session-zzz",
      refreshFingerprint: "fp-x",
      ttlSeconds: 3600,
    });
    expect(outcome.sessionId).toBeNull();
    expect(outcome.reason).toContain("Principal not found");
  });
});
