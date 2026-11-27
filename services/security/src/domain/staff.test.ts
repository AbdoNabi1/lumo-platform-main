import { describe, expect, it } from "vitest";
import { OWNER_ROLE_KEY, STAFF_ROLES } from "./staff";

describe("staff vocabulary", () => {
  it("fixes the staff roles and the owner role key", () => {
    expect(STAFF_ROLES).toEqual(["admin", "operator", "viewer"]);
    expect(OWNER_ROLE_KEY).toBe("platform-admin");
  });
});
