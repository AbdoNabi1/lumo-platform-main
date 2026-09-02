import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { AuditChain } from "../domain/audit-chain";
import { Credential } from "../domain/credential";
import { Incident } from "../domain/incident";
import { Policy } from "../domain/policy";
import { Principal } from "../domain/principal";
import { RelationTuple } from "../domain/relationship";
import { RotationPolicy } from "../domain/value-objects/rotation-policy";
import * as M from "./prisma-mappers";

const now = new Date("2026-07-18T00:00:00.000Z");
const uid = (v: string): UniqueEntityId => UniqueEntityId.from(v);
const rp = (): RotationPolicy => {
  const r = RotationPolicy.create({ intervalDays: 30, graceSeconds: 3600, autoRotate: true });
  if (!r.ok) throw r.error;
  return r.value;
};

// The Prisma delegate returns snake_case→camelCase rows; `toRow` produces the same field names it reads
// in `toDomain`, so a round-trip through the mapper proves persistence fidelity without a database.
describe("Prisma mappers (round-trip fidelity — G-SEC-1)", () => {
  it("Principal survives toRow → toDomain", () => {
    const p = Principal.register(
      uid("p1"),
      {
        externalId: "svc-1",
        kind: "service_account",
        displayName: "Svc",
        tenantRef: "t1",
        attributes: { clearance: "high" },
      },
      "e",
      now,
    );
    const back = M.PrincipalMapper.toDomain({ ...M.PrincipalMapper.toRow(p, "tenant") });
    expect(back.externalId).toBe("svc-1");
    expect(back.kind).toBe("service_account");
    expect(back.attributes["clearance"]).toBe("high");
    expect(back.version).toBe(1);
  });

  it("Credential preserves rotation policy + lineage", () => {
    const c = Credential.issue(
      uid("c1"),
      {
        principalRef: "p1",
        kind: "api_key",
        fingerprint: "fp",
        kmsKeyRef: "kms://k",
        rotationPolicy: rp(),
      },
      "e",
      now,
    );
    const back = M.CredentialMapper.toDomain({ ...M.CredentialMapper.toRow(c, "tenant") });
    expect(back.kind).toBe("api_key");
    expect(back.fingerprint).toBe("fp");
    expect(back.rotationPolicy?.intervalDays).toBe(30);
    expect(back.rotationDueAt?.getTime()).toBe(c.rotationDueAt?.getTime());
  });

  it("Policy preserves immutable versions", () => {
    const p = Policy.define(uid("pol"), { key: "p1", name: "P", mode: "custom" }, "e", now);
    p.publishVersion(
      {
        rules: [{ id: "r1", description: "block", when: { minRisk: 50 }, effect: "block" }],
        defaultEffect: "allow",
      },
      "e",
      now,
    );
    const back = M.PolicyMapper.toDomain({ ...M.PolicyMapper.toRow(p, "tenant") });
    expect(back.activeVersionNumber).toBe(1);
    expect(back.activePolicyVersion()?.rules[0]?.id).toBe("r1");
    expect(back.activePolicyVersion()?.defaultEffect).toBe("allow");
  });

  it("Incident preserves timeline + evidence", () => {
    const i = Incident.open(
      uid("i1"),
      { reference: "INC-1", title: "Leak", severity: "high", category: "leak" },
      "e",
      now,
    );
    i.addEvidence("audit_record", "rec-1", "e", now);
    i.triage("soc", "assigned", "e", now);
    const back = M.IncidentMapper.toDomain({ ...M.IncidentMapper.toRow(i, "tenant") });
    expect(back.status).toBe("triaged");
    expect(back.evidence).toHaveLength(1);
    expect(back.timeline.length).toBeGreaterThanOrEqual(3);
    expect(back.evidence[0]?.at).toBeInstanceOf(Date);
  });

  it("RelationTuple + AuditRecord survive round-trip", () => {
    const t = new RelationTuple({
      id: "t1",
      namespace: "app",
      object: "doc:readme",
      relation: "viewer",
      subject: "svc-1",
    });
    const backTuple = M.RelationTupleMapper.toDomain(M.RelationTupleMapper.toRow(t, "tenant"));
    expect(backTuple.key()).toBe(t.key());

    const rec = new AuditChain().append(null, {
      id: "a1",
      principalRef: "svc-1",
      action: "orders:refund",
      decision: "allow",
      occurredAt: now.toISOString(),
      tenantRef: "t1",
      metadata: { k: "v" },
    });
    const backRec = M.AuditRecordMapper.toDomain({ ...M.AuditRecordMapper.toRow(rec, "tenant") });
    expect(backRec.hash).toBe(rec.hash);
    expect(backRec.content.tenantRef).toBe("t1");
    expect(new AuditChain().verify([backRec]).valid).toBe(true);
  });
});
