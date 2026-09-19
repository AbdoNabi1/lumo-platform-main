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
    clock,
  });
}

describe("incidents / threat intel / trust center / analytics (end to end)", () => {
  it("runs the SOC lifecycle, detects threats, and surfaces the Trust Center + analytics", async () => {
    const app = wire();
    app.threatProvider.seed("9.9.9.9", {
      malicious: true,
      score: 90,
      categories: ["c2", "botnet"],
    });

    // ── §10 threat intelligence ──
    const clean = body<{ malicious: boolean; providers: string[] }>(
      await app.security.checkThreatIndicator({ tenantId: "tenant-a", indicator: "1.1.1.1" }),
    );
    expect(clean.malicious).toBe(false);
    expect(clean.providers).toContain("reference-feed");
    const malicious = body<{ malicious: boolean; score: number; categories: string[] }>(
      await app.security.checkThreatIndicator({ tenantId: "tenant-a", indicator: "9.9.9.9" }),
    );
    expect(malicious.malicious).toBe(true);
    expect(malicious.score).toBe(90);

    // ── §11 incident lifecycle ──
    const opened = await app.security.openIncident({
      tenantId: "tenant-a",
      title: "C2 beacon from 9.9.9.9",
      severity: "critical",
      category: "malware",
      tenantRef: "t1",
      reference: "INC-100",
    });
    expect(opened.status).toBe(201);
    await app.security.addIncidentEvidence({
      tenantId: "tenant-a",
      reference: "INC-100",
      kind: "threat_verdict",
      ref: "9.9.9.9:90",
    });
    await app.security.triageIncident({
      tenantId: "tenant-a",
      reference: "INC-100",
      assignee: "soc-1",
      note: "confirmed",
    });
    await app.security.mitigateIncident({
      tenantId: "tenant-a",
      reference: "INC-100",
      note: "blocked IP, revoked sessions",
    });
    const resolved = await app.security.resolveIncident({
      tenantId: "tenant-a",
      reference: "INC-100",
      resolution: "contained",
    });
    expect(body<{ status: string }>(resolved).status).toBe("resolved");
    // invalid transition surfaces as 409
    expect(
      (
        await app.security.triageIncident({
          tenantId: "tenant-a",
          reference: "INC-100",
          assignee: "x",
          note: "y",
        })
      ).status,
    ).toBe(409);

    // a second, still-open incident for the explorer/trust-center counts
    await app.security.openIncident({
      tenantId: "tenant-a",
      title: "Brute force",
      severity: "high",
      category: "brute_force",
      tenantRef: "t1",
      reference: "INC-101",
    });

    // ── §11 incident explorer ──
    const explorer = await app.security.incidentExplorer("tenant-a");
    expect(explorer.total).toBe(2);
    expect(explorer.open).toBe(1); // INC-100 resolved (not open), INC-101 open
    expect(explorer.bySeverity["critical"]).toBe(1);

    // ── §13 security analytics (threat indicator bumped the counter) ──
    const analytics = app.security.securityAnalytics();
    expect(analytics.threatsIndicated).toBeGreaterThanOrEqual(1);

    // ── §12 trust center (real-data posture aggregate) ──
    await app.security.registerComplianceRule({
      tenantId: "tenant-a",
      id: "CC7.2",
      framework: "soc2",
      description: "Audit trail",
      severity: "critical",
    });
    const trust = await app.security.trustCenter("tenant-a", "t1");
    expect(trust.auditChainValid).toBe(true);
    expect(trust.openIncidents).toBe(1);
    expect(trust.complianceControls).toBeGreaterThanOrEqual(1);
    expect(trust.frameworks).toContain("soc2");
    expect(trust.postureScore).toBeGreaterThanOrEqual(0);
    expect(trust.postureScore).toBeLessThanOrEqual(100);

    // ── canonical events ──
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "security.threat.detected",
        "security.incident.opened",
        "security.incident.evidence_added",
        "security.incident.triaged",
        "security.incident.mitigated",
        "security.incident.resolved",
      ]),
    );
  });
});
