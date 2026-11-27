import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

// Fake local values, nothing real.
const base = {
  DATABASE_URL: "postgresql://u:***@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  APP_ENV: "local",
} satisfies NodeJS.ProcessEnv;

describe("STAFF_TWO_STEP (Wave 1f)", () => {
  it("defaults to required", () => {
    expect(loadRuntimeConfig(base).STAFF_TWO_STEP).toBe("required");
  });

  it.each(["required", "optional"] as const)("accepts %s", (value) => {
    expect(loadRuntimeConfig({ ...base, STAFF_TWO_STEP: value }).STAFF_TWO_STEP).toBe(value);
  });

  it("refuses anything else (no silent fallback to optional)", () => {
    expect(() => loadRuntimeConfig({ ...base, STAFF_TWO_STEP: "off" })).toThrow(/STAFF_TWO_STEP/);
    expect(() => loadRuntimeConfig({ ...base, STAFF_TWO_STEP: "" })).toThrow(/STAFF_TWO_STEP/);
  });
});
