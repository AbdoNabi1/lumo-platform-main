import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { MfaEnrollment } from "./mfa-enrollment";

const NOW = new Date("2026-11-27T10:00:00.000Z");
const make = () =>
  MfaEnrollment.enroll(
    UniqueEntityId.from("e-1"),
    { principalRef: "p-1", method: "totp", secretRef: "s" },
    "evt-1",
    NOW,
  );

describe("MfaEnrollment.acceptStep (TOTP replay guard)", () => {
  it("starts with no step used", () => {
    expect(make().lastUsedStep).toBeNull();
  });

  it("accepts the first step and records it", () => {
    const e = make();
    expect(e.acceptStep(100)).toBe(true);
    expect(e.lastUsedStep).toBe(100);
  });

  it("refuses the same step twice and changes nothing", () => {
    const e = make();
    e.acceptStep(100);
    expect(e.acceptStep(100)).toBe(false);
    expect(e.lastUsedStep).toBe(100);
  });

  it("refuses an older step after a newer one was used", () => {
    const e = make();
    e.acceptStep(101);
    expect(e.acceptStep(100)).toBe(false);
    expect(e.lastUsedStep).toBe(101);
  });

  it("accepts a strictly newer step", () => {
    const e = make();
    e.acceptStep(100);
    expect(e.acceptStep(101)).toBe(true);
    expect(e.lastUsedStep).toBe(101);
  });

  it("accepts step 0 as a first step (null is not 0)", () => {
    const e = make();
    expect(e.acceptStep(0)).toBe(true);
    expect(e.acceptStep(0)).toBe(false);
  });

  it("survives reconstitute", () => {
    const e = make();
    e.acceptStep(7);
    const back = MfaEnrollment.reconstitute(UniqueEntityId.from("e-1"), {
      principalRef: e.principalRef,
      method: e.method,
      status: e.status,
      secretRef: e.secretRef,
      backupCodeHashes: [...e.backupCodeHashes],
      deviceRef: e.deviceRef,
      createdAt: e.createdAt,
      activatedAt: e.activatedAt,
      lastUsedStep: e.lastUsedStep,
      version: 2,
    });
    expect(back.lastUsedStep).toBe(7);
    expect(back.acceptStep(7)).toBe(false);
  });
});
