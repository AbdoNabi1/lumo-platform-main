import { describe, expect, it } from "vitest";
import { Registry } from "./registry";

interface Thing {
  readonly label: string;
}

function fixedClock(): () => Date {
  let t = 0;
  return () => new Date(t++ * 1000);
}

describe("Registry Engine (@platform/registry)", () => {
  it("registers, looks up, and reports membership", () => {
    const r = new Registry<Thing>({ name: "things", now: fixedClock() });
    const res = r.register({
      key: "a",
      value: { label: "A" },
      tags: ["core"],
      metadata: { unit: "u" },
    });
    expect(res.ok).toBe(true);
    expect(r.has("a")).toBe(true);
    expect(r.get("a")?.value.label).toBe("A");
    expect(r.get("a")?.version).toBe(1);
    expect(r.get("a")?.status).toBe("active");
    expect(r.get("missing")).toBeNull();
  });

  it("mints a new immutable version on re-registration and preserves history", () => {
    const r = new Registry<Thing>({ name: "things", now: fixedClock() });
    r.register({ key: "a", value: { label: "v1" } });
    r.register({ key: "a", value: { label: "v2" } });
    expect(r.get("a")?.version).toBe(2);
    expect(r.get("a")?.value.label).toBe("v2");
    expect(r.versions("a").map((e) => e.value.label)).toEqual(["v1", "v2"]);
    expect(r.getVersion("a", 1)?.value.label).toBe("v1");
    // registeredAt is stable across versions; updatedAt advances.
    expect(r.versions("a")[0]?.registeredAt).toBe(r.get("a")?.registeredAt);
  });

  it("rejects an empty key and a validator failure", () => {
    const r = new Registry<Thing>({
      name: "things",
      validate: (v) => {
        if (v.label.length === 0) throw new Error("label required");
      },
    });
    expect(r.register({ key: "  ", value: { label: "x" } }).ok).toBe(false);
    const bad = r.register({ key: "a", value: { label: "" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("VALIDATION");
  });

  it("discovers by status, tag, and metadata", () => {
    const r = new Registry<Thing>({ name: "things", now: fixedClock() });
    r.register({ key: "a", value: { label: "A" }, tags: ["billable"], metadata: { cat: "ai" } });
    r.register({ key: "b", value: { label: "B" }, tags: ["internal"], metadata: { cat: "ops" } });
    expect(r.list({ tag: "billable" }).map((e) => e.key)).toEqual(["a"]);
    expect(r.list({ metadata: { cat: "ops" } }).map((e) => e.key)).toEqual(["b"]);
    expect(r.list().length).toBe(2);
  });

  it("moves through the lifecycle and blocks reactivation of a retired entry", () => {
    const r = new Registry<Thing>({ name: "things", now: fixedClock() });
    r.register({ key: "a", value: { label: "A" } });
    expect(r.deprecate("a").ok).toBe(true);
    expect(r.get("a")?.status).toBe("deprecated");
    expect(r.list({ status: "deprecated" }).map((e) => e.key)).toEqual(["a"]);
    expect(r.retire("a").ok).toBe(true);
    const reactivate = r.transition("a", "active");
    expect(reactivate.ok).toBe(false);
    expect(r.transition("ghost", "active").ok).toBe(false);
  });

  it("requireActive resolves only active entries", () => {
    const r = new Registry<Thing>({ name: "things", now: fixedClock() });
    r.register({ key: "a", value: { label: "A" } });
    expect(r.requireActive("a").ok).toBe(true);
    r.deprecate("a");
    const denied = r.requireActive("a");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("BUSINESS_RULE");
    expect(r.requireActive("missing").ok).toBe(false);
  });
});
