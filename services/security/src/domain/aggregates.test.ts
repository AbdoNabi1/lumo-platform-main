import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Credential } from "./credential";
import { Delegation } from "./delegation";
import { Policy } from "./policy";
import { Principal } from "./principal";
import { Session } from "./session";

const now = new Date("2026-07-17T00:00:00.000Z");
let n = 0;
const id = (): UniqueEntityId => UniqueEntityId.from(`id-${(n += 1)}`);

describe("Principal", () => {
  it("requires a subjectRef for human, forbids it for non-human", () => {
    expect(() =>
      Principal.register(id(), { externalId: "u1", kind: "human", displayName: "U" }, "e", now),
    ).toThrow(BusinessRuleError);
    expect(() =>
      Principal.register(
        id(),
        { externalId: "svc", kind: "service_account", displayName: "S", subjectRef: "x" },
        "e",
        now,
      ),
    ).toThrow(BusinessRuleError);
    const svc = Principal.register(
      id(),
      { externalId: "svc", kind: "service_account", displayName: "S" },
      "e",
      now,
    );
    expect(svc.isActive).toBe(true);
  });

  it("treats disabled as terminal", () => {
    const p = Principal.register(
      id(),
      { externalId: "svc", kind: "machine", displayName: "M" },
      "e",
      now,
    );
    p.disable("e", now);
    expect(() => p.activate("e", now)).toThrow(BusinessRuleError);
  });
});

describe("Credential", () => {
  it("cannot be issued already expired and rotates only when active", () => {
    expect(() =>
      Credential.issue(
        id(),
        {
          principalRef: "p",
          kind: "api_key",
          fingerprint: "fp",
          expiresAt: new Date(now.getTime() - 1),
        },
        "e",
        now,
      ),
    ).toThrow(BusinessRuleError);
    const c = Credential.issue(
      id(),
      { principalRef: "p", kind: "api_key", fingerprint: "fp" },
      "e",
      now,
    );
    c.markRotated("e", now);
    expect(c.status).toBe("rotated");
    expect(() => c.markRotated("e", now)).toThrow(BusinessRuleError);
  });
});

describe("Session", () => {
  it("rejects refresh-token reuse and expires when due", () => {
    const s = Session.establish(
      id(),
      { principalRef: "p", refreshFingerprint: "f1", expiresAt: new Date(now.getTime() + 1000) },
      "e",
      now,
    );
    expect(() => s.refresh("f1", new Date(now.getTime() + 2000), "e", now)).toThrow(
      BusinessRuleError,
    );
    s.refresh("f2", new Date(now.getTime() + 2000), "e", now);
    expect(s.refreshCount).toBe(1);
    expect(s.expireIfDue(new Date(now.getTime() + 5000), "e")).toBe(true);
    expect(s.status).toBe("expired");
  });
});

describe("Policy", () => {
  it("requires an explicit default effect in custom mode and versions immutably", () => {
    const p = Policy.define(id(), { key: "pol", name: "P", mode: "custom" }, "e", now);
    expect(() => p.publishVersion({ rules: [] }, "e", now)).toThrow(BusinessRuleError);
    const v1 = p.publishVersion({ rules: [], defaultEffect: "block" }, "e", now);
    const v2 = p.publishVersion({ rules: [], defaultEffect: "allow" }, "e", now);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(p.activeVersionNumber).toBe(2);
    expect(Object.isFrozen(v1)).toBe(true);
  });

  it("defaults the effect from a preset mode", () => {
    const p = Policy.define(id(), { key: "strict", name: "S", mode: "strict" }, "e", now);
    const v = p.publishVersion({ rules: [] }, "e", now);
    expect(v.defaultEffect).toBe("block");
  });
});

describe("Delegation", () => {
  it("rejects self-delegation", () => {
    expect(() => Delegation.grant(id(), { delegatorRef: "a", delegateRef: "a" }, "e", now)).toThrow(
      BusinessRuleError,
    );
    const d = Delegation.grant(id(), { delegatorRef: "a", delegateRef: "b" }, "e", now);
    expect(d.isActiveAt(now)).toBe(true);
  });
});
