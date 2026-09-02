import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Device } from "./device";

const now = new Date("2026-07-17T00:00:00.000Z");
let n = 0;
const id = (): UniqueEntityId => UniqueEntityId.from(`id-${(n += 1)}`);

describe("Device", () => {
  it("registers untrusted with neutral reputation", () => {
    const d = Device.register(id(), { fingerprint: "fp-1" }, "e", now);
    expect(d.trustLevel).toBe("untrusted");
    expect(d.reputation).toBe(50);
    expect(d.isTrusted).toBe(false);
  });

  it("lowers reputation and counts anomalies on high-severity signals", () => {
    const d = Device.register(id(), { fingerprint: "fp-1" }, "e", now);
    d.recordSignal({ type: "impossible_travel", severity: "high", at: now });
    expect(d.reputation).toBe(20);
    expect(d.anomalyCount).toBe(1);
  });

  it("trusts a device and blocks it (blocked cannot be trusted directly)", () => {
    const d = Device.register(id(), { fingerprint: "fp-1" }, "e", now);
    d.trust("e", now);
    expect(d.trustLevel).toBe("trusted");
    expect(d.reputation).toBeGreaterThanOrEqual(80);

    const b = Device.register(id(), { fingerprint: "fp-2" }, "e", now);
    b.block("e", now);
    expect(b.isBlocked).toBe(true);
    expect(b.reputation).toBe(0);
    expect(() => b.trust("e", now)).toThrow(BusinessRuleError);
  });
});
