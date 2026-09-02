import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Credential } from "./credential";
import { RotationPolicy } from "./value-objects/rotation-policy";

const now = new Date("2026-07-17T00:00:00.000Z");
let n = 0;
const id = (): UniqueEntityId => UniqueEntityId.from(`id-${(n += 1)}`);
const policy = (intervalDays: number, graceSeconds: number): RotationPolicy => {
  const p = RotationPolicy.create({ intervalDays, graceSeconds, autoRotate: true });
  if (!p.ok) throw p.error;
  return p.value;
};
const daysLater = (d: number): Date => new Date(now.getTime() + d * 86_400_000);

describe("Credential rotation (§7)", () => {
  it("schedules the next rotation and reports when due", () => {
    const c = Credential.issue(
      id(),
      { principalRef: "p", kind: "api_key", fingerprint: "fp", rotationPolicy: policy(30, 3600) },
      "e",
      now,
    );
    expect(c.rotationDueAt?.getTime()).toBe(daysLater(30).getTime());
    expect(c.isDueForRotation(now)).toBe(false);
    expect(c.isDueForRotation(daysLater(31))).toBe(true);
  });

  it("keeps a rotated credential valid within its grace window, then invalid", () => {
    const c = Credential.issue(
      id(),
      { principalRef: "p", kind: "api_key", fingerprint: "fp", rotationPolicy: policy(30, 3600) },
      "e",
      now,
    );
    c.markRotated("e", now);
    expect(c.status).toBe("rotated");
    expect(c.isValidAt(new Date(now.getTime() + 1000))).toBe(true); // within 3600s grace
    expect(c.isValidAt(new Date(now.getTime() + 7200_000))).toBe(false); // past grace
  });

  it("scheduleRotation only applies to active credentials", () => {
    const c = Credential.issue(
      id(),
      { principalRef: "p", kind: "api_key", fingerprint: "fp" },
      "e",
      now,
    );
    c.scheduleRotation(policy(7, 0), "e", now);
    expect(c.rotationDueAt?.getTime()).toBe(daysLater(7).getTime());
    expect(c.autoRotate).toBe(true);
  });
});
