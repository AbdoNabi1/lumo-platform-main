import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Membership } from "../domain/membership";
import { Organization, type OrganizationStatus } from "../domain/organization";
import { User, type UserStatus } from "../domain/user";
import { Email } from "../domain/value-objects/email";
import { OrganizationSlug } from "../domain/value-objects/organization-slug";
import { RoleName } from "../domain/value-objects/role-name";

export interface UserRow {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
}

export interface OrganizationRow {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
}

export interface MembershipRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly roleName: string;
  readonly version: number;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt identity row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/** Persistence <-> aggregate mapping for {@link User}/{@link Organization}/{@link Membership}. Mapping only — no I/O. */
export class AccessMappers {
  static toUserDomain(row: UserRow): User {
    return User.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantId,
      must(Email.create(row.email), "email"),
      row.name,
      row.status as UserStatus,
      row.version,
    );
  }

  static toUserRow(user: User) {
    return {
      id: user.id.toString(),
      tenantId: user.tenantId,
      email: user.email.value,
      name: user.name,
      status: user.status,
    };
  }

  static toOrganizationDomain(row: OrganizationRow): Organization {
    return Organization.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantId,
      must(OrganizationSlug.create(row.slug), "organization slug"),
      row.name,
      row.status as OrganizationStatus,
      row.version,
    );
  }

  static toOrganizationRow(organization: Organization) {
    return {
      id: organization.id.toString(),
      tenantId: organization.tenantId,
      slug: organization.slug.value,
      name: organization.name,
      status: organization.status,
    };
  }

  static toMembershipDomain(row: MembershipRow): Membership {
    return Membership.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantId,
      row.userId,
      row.organizationId,
      must(RoleName.create(row.roleName), "role name"),
      row.version,
    );
  }

  static toMembershipRow(membership: Membership) {
    return {
      id: membership.id.toString(),
      tenantId: membership.tenantId,
      userId: membership.userId,
      organizationId: membership.organizationId,
      roleName: membership.roleName.value,
    };
  }
}
