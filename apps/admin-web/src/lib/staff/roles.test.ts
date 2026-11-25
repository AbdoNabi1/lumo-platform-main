import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES, STAFF_STATUSES } from "./roles";
import * as staffApi from "@/lib/api/staff";

// `next build` rejects a Client Component that takes a VALUE from a module importing the
// server-only API client (`next/headers`). Only erased `import type` is safe from there.
const USERS_DIR = join(process.cwd(), "src", "components", "settings", "users");
const NON_TYPE_API_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?\sfrom\s+["'](?:@\/lib\/api\/|(?:\.\.?\/)+(?:[\w-]+\/)*lib\/api\/)/m;

describe("staff vocabulary", () => {
  it("keeps the role order the role picker renders", () => {
    expect.hasAssertions();
    expect(STAFF_ROLES).toEqual(["admin", "operator", "viewer"]);
  });

  it("lists every staff status", () => {
    expect.hasAssertions();
    expect(STAFF_STATUSES).toEqual(["active", "invited", "invitation_expired", "deactivated"]);
  });

  it("is re-exported unchanged by the server-side staff client", () => {
    expect.hasAssertions();
    expect(staffApi.STAFF_ROLES).toBe(STAFF_ROLES);
  });
});

describe("components/settings/users client boundary", () => {
  const files = readdirSync(USERS_DIR).filter((name) => name.endsWith(".tsx"));

  it("finds the component files", () => {
    expect.hasAssertions();
    expect(files).toContain("role-choice.tsx");
  });

  it("detects a value import but not a type import", () => {
    expect.hasAssertions();
    expect(NON_TYPE_API_IMPORT.test('import { STAFF_ROLES } from "@/lib/api/staff";')).toBe(true);
    expect(NON_TYPE_API_IMPORT.test('import { A, type B } from "@/lib/api/staff";')).toBe(true);
    expect(NON_TYPE_API_IMPORT.test('import {\n  A,\n} from "@/lib/api/staff";')).toBe(true);
    expect(NON_TYPE_API_IMPORT.test('import type { B } from "@/lib/api/staff";')).toBe(false);
    expect(NON_TYPE_API_IMPORT.test('import { A } from "@/lib/staff/roles";')).toBe(false);
  });

  it.each(files)("%s has no non-type import from @/lib/api/", (name) => {
    expect.hasAssertions();
    const source = readFileSync(join(USERS_DIR, name), "utf8");
    expect(NON_TYPE_API_IMPORT.test(source)).toBe(false);
  });
});
