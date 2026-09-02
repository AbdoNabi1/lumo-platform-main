import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Incident } from "./incident";

const now = new Date("2026-07-17T00:00:00.000Z");
let n = 0;
const id = (): UniqueEntityId => UniqueEntityId.from(`id-${(n += 1)}`);
const open = (): Incident =>
  Incident.open(
    id(),
    { reference: "INC-1", title: "Credential leak", severity: "high", category: "credential_leak" },
    "e",
    now,
  );

describe("Incident (§11)", () => {
  it("drives the detection → triage → mitigation → resolution → closure lifecycle", () => {
    const i = open();
    expect(i.status).toBe("detected");
    expect(i.timeline).toHaveLength(1);
    i.triage("soc-analyst", "assigned", "e", now);
    expect(i.status).toBe("triaged");
    expect(i.assignee).toBe("soc-analyst");
    i.mitigate("rotated keys", "e", now);
    expect(i.status).toBe("mitigating");
    i.resolve("keys rotated, access revoked", "e", now);
    expect(i.status).toBe("resolved");
    expect(i.resolution).toBe("keys rotated, access revoked");
    i.close("post-mortem filed", "e", now);
    expect(i.status).toBe("closed");
    expect(i.isOpen).toBe(false);
    expect(i.timeline.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects invalid transitions", () => {
    const i = open();
    expect(() => i.resolve("skip", "e", now)).toThrow(BusinessRuleError); // detected → resolved not allowed
  });

  it("records evidence and forbids it after closure", () => {
    const i = open();
    i.addEvidence("audit_record", "rec-42", "e", now);
    expect(i.evidence).toHaveLength(1);
    i.close("false positive", "e", now); // detected → closed allowed
    expect(() => i.addEvidence("x", "y", "e", now)).toThrow(BusinessRuleError);
  });
});
