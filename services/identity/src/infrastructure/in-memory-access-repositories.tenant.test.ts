import { describe, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Membership } from "../domain/membership";
import { Organization } from "../domain/organization";
import { User } from "../domain/user";
import { Email } from "../domain/value-objects/email";
import { OrganizationSlug } from "../domain/value-objects/organization-slug";
import { RoleName } from "../domain/value-objects/role-name";
import {
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  InMemoryUserRepository,
} from "./in-memory-access-repositories";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup: invalid VO");
  return r.value;
}

let n = 0;
const nextId = () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
const context = () => rootEventContext({ generate: nextId });

/**
 * ADR-0014 decision point 1: identity's access `save` takes no `tenantId` parameter — the
 * aggregate carries it, so the write-time merge reads `aggregate.tenantId`. The scenario builds each
 * aggregate for the helper's tenant, so the envelope must carry the aggregate's tenant.
 */
describe("identity access repositories write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("User: the envelope carries the aggregate's tenant", async () => {
    await assertWriteTimeTenant("identity/user", async (outbox, tenantId) => {
      const repository = new InMemoryUserRepository({ outbox, context: context() });
      await repository.save(
        User.create(
          UniqueEntityId.from(nextId()),
          tenantId,
          must(Email.create("a@example.com")),
          "A",
          nextId(),
          new Date(0),
        ),
      );
    });
  });

  it("Organization: the envelope carries the aggregate's tenant", async () => {
    await assertWriteTimeTenant("identity/organization", async (outbox, tenantId) => {
      const repository = new InMemoryOrganizationRepository({ outbox, context: context() });
      await repository.save(
        Organization.create(
          UniqueEntityId.from(nextId()),
          tenantId,
          must(OrganizationSlug.create("acme")),
          "Acme",
          nextId(),
          new Date(0),
        ),
      );
    });
  });

  it("Membership: the envelope carries the aggregate's tenant", async () => {
    await assertWriteTimeTenant("identity/membership", async (outbox, tenantId) => {
      const repository = new InMemoryMembershipRepository({ outbox, context: context() });
      await repository.save(
        Membership.create(
          UniqueEntityId.from(nextId()),
          tenantId,
          "user-1",
          "org-1",
          must(RoleName.create("admin")),
          nextId(),
          new Date(0),
        ),
      );
    });
  });
});
