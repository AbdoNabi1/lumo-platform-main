import { describe, expect, it } from "vitest";
import { applyFieldUpdate, createEmptyProfile } from "./customer-profile";
import { fromSnapshot, toSnapshot } from "./profile-snapshot";

const identifier = { type: "customer_id" as const, value: "cust-1" };

describe("profile snapshot round-trip", () => {
  it("fromSnapshot(toSnapshot(profile)) reconstructs an equivalent profile", () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;

    const snapshot = toSnapshot(profile, "updated", "2026-07-21T00:00:02.000Z");
    expect(snapshot.reason).toBe("updated");
    expect(snapshot.version).toBe(profile.version);

    const reconstructed = fromSnapshot(snapshot);
    expect(reconstructed.identifierType).toBe(profile.identifierType);
    expect(reconstructed.identifierValue).toBe(profile.identifierValue);
    expect(reconstructed.version).toBe(profile.version);
    expect(reconstructed.fields).toEqual(profile.fields);
    expect(reconstructed.updatedAt).toBe(snapshot.capturedAt);
  });
});
