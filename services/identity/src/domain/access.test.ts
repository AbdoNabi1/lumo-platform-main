import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { BusinessRuleError } from "@platform/utils";
import { Membership } from "./membership";
import { Organization } from "./organization";
import { User } from "./user";
import { Email } from "./value-objects/email";
import { OrganizationSlug } from "./value-objects/organization-slug";
import { RoleName } from "./value-objects/role-name";

function email(value = "alice@example.com"): Email {
  const result = Email.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function slug(value = "acme"): OrganizationSlug {
  const result = OrganizationSlug.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function roleName(value = "admin"): RoleName {
  const result = RoleName.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function user(): User {
  return User.create(
    UniqueEntityId.from("user-1"),
    "tenant-1",
    email(),
    "Alice",
    "evt-1",
    new Date(0),
  );
}

function organization(): Organization {
  return Organization.create(
    UniqueEntityId.from("org-1"),
    "tenant-1",
    slug(),
    "Acme",
    "evt-2",
    new Date(0),
  );
}

describe("User", () => {
  it("creates active and emits user.created", () => {
    const u = user();
    expect(u.isActive).toBe(true);
    const events = u.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("user.created");
  });

  it("renames and emits user.updated", () => {
    const u = user();
    u.pullDomainEvents();
    u.rename("Alicia", "evt-3", new Date(0));
    expect(u.name).toBe("Alicia");
    expect(u.pullDomainEvents()[0]?.eventName).toBe("user.updated");
  });

  it("deactivates and emits user.deactivated", () => {
    const u = user();
    u.pullDomainEvents();
    u.deactivate("evt-4", new Date(0));
    expect(u.status).toBe("deactivated");
    expect(u.pullDomainEvents()[0]?.eventName).toBe("user.deactivated");
  });

  it("rejects deactivating an already-deactivated user", () => {
    const u = user();
    u.deactivate("evt-4", new Date(0));
    expect(() => u.deactivate("evt-5", new Date(0))).toThrow(BusinessRuleError);
  });
});

describe("Organization", () => {
  it("creates active and emits organization.created", () => {
    const org = organization();
    expect(org.isActive).toBe(true);
    const events = org.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("organization.created");
  });

  it("archives (no dedicated event — not in the report's 6-event list)", () => {
    const org = organization();
    org.pullDomainEvents();
    org.archive();
    expect(org.status).toBe("archived");
    expect(org.pullDomainEvents()).toHaveLength(0);
  });

  it("rejects archiving an already-archived organization", () => {
    const org = organization();
    org.archive();
    expect(() => org.archive()).toThrow(BusinessRuleError);
  });
});

describe("Membership", () => {
  it("creates with a role name reference and emits membership.created", () => {
    const membership = Membership.create(
      UniqueEntityId.from("mem-1"),
      "tenant-1",
      "user-1",
      "org-1",
      roleName(),
      "evt-5",
      new Date(0),
    );
    expect(membership.roleName.value).toBe("admin");
    const events = membership.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("membership.created");
  });

  it("changes role and emits membership.role_changed", () => {
    const membership = Membership.create(
      UniqueEntityId.from("mem-1"),
      "tenant-1",
      "user-1",
      "org-1",
      roleName(),
      "evt-5",
      new Date(0),
    );
    membership.pullDomainEvents();
    membership.changeRole(roleName("viewer"), "evt-6", new Date(0));
    expect(membership.roleName.value).toBe("viewer");
    expect(membership.pullDomainEvents()[0]?.eventName).toBe("membership.role_changed");
  });
});
