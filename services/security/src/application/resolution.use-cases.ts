import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { SecurityDeps } from "./deps";

/**
 * The **live identity resolution** surface (H-2 / G-SEC-4). Each use-case resolves an identity fact
 * across the frozen ownership boundary: Security's own Principal/MachineIdentity aggregates joined to the
 * Identity **projection** (users/orgs/memberships fed by `identity.*` events). Read-only, no mutation, no
 * audit anchor. Ownership is preserved — Security never re-owns Identity's users/orgs/memberships; it
 * resolves against a read copy.
 */

export interface ResolvePrincipalInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  /** The Identity subject id (a human principal's `subjectRef`, the shared identity id). */
  readonly subjectRef: string;
}
export interface ResolvedMembership {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly role: string;
  readonly organizationSlug: string | null;
}
export interface ResolvedPrincipal {
  readonly principal: {
    readonly id: string;
    readonly externalId: string;
    readonly kind: string;
    readonly status: string;
    readonly tenantRef: string | null;
  } | null;
  readonly identityUser: {
    readonly userId: string;
    readonly status: string;
    readonly userTenant: string | null;
  } | null;
  readonly memberships: readonly ResolvedMembership[];
}

/** Resolves a Kratos/Identity subject to the Security principal + the projected Identity user + memberships. */
export class ResolvePrincipal implements UseCase<
  ResolvePrincipalInput,
  ResolvedPrincipal,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: ResolvePrincipalInput): Promise<Result<ResolvedPrincipal, DomainError>> {
    const principal = await this.deps.principals.findBySubjectRef(input.subjectRef, input.tenantId);
    const user = await this.deps.identityProjection.getUser(input.subjectRef, input.tenantId);
    const memberships = await this.resolveMemberships(input.subjectRef, input.tenantId);
    return ok({
      principal:
        principal === null
          ? null
          : {
              id: principal.id.toString(),
              externalId: principal.externalId,
              kind: principal.kind,
              status: principal.status,
              tenantRef: principal.tenantRef,
            },
      identityUser:
        user === null
          ? null
          : { userId: user.userId, status: user.status, userTenant: user.userTenant },
      memberships,
    });
  }

  private async resolveMemberships(
    userId: string,
    tenantId: string,
  ): Promise<readonly ResolvedMembership[]> {
    const rows = await this.deps.identityProjection.listMembershipsByUser(userId, tenantId);
    const resolved: ResolvedMembership[] = [];
    for (const m of rows) {
      const org = await this.deps.identityProjection.getOrganization(m.organizationId, tenantId);
      resolved.push({
        membershipId: m.membershipId,
        organizationId: m.organizationId,
        role: m.role,
        organizationSlug: org?.slug ?? null,
      });
    }
    return resolved;
  }
}

export interface ResolveMembershipInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly userId: string;
}
export interface MembershipResolution {
  readonly userId: string;
  readonly memberships: readonly ResolvedMembership[];
}

/** Resolves the organizations + roles a user belongs to (from the Identity membership projection). */
export class ResolveMembership implements UseCase<
  ResolveMembershipInput,
  MembershipResolution,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: ResolveMembershipInput): Promise<Result<MembershipResolution, DomainError>> {
    const rows = await this.deps.identityProjection.listMembershipsByUser(
      input.userId,
      input.tenantId,
    );
    const memberships: ResolvedMembership[] = [];
    for (const m of rows) {
      const org = await this.deps.identityProjection.getOrganization(
        m.organizationId,
        input.tenantId,
      );
      memberships.push({
        membershipId: m.membershipId,
        organizationId: m.organizationId,
        role: m.role,
        organizationSlug: org?.slug ?? null,
      });
    }
    return ok({ userId: input.userId, memberships });
  }
}

export interface ResolveOrganizationInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly organizationId: string;
}
export interface OrganizationResolution {
  readonly organizationId: string;
  readonly slug: string;
  readonly tenant: string | null;
}

/** Resolves an organization from the Identity organization projection. */
export class ResolveOrganization implements UseCase<
  ResolveOrganizationInput,
  OrganizationResolution,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: ResolveOrganizationInput,
  ): Promise<Result<OrganizationResolution, DomainError>> {
    const org = await this.deps.identityProjection.getOrganization(
      input.organizationId,
      input.tenantId,
    );
    if (org === null) return err(new NotFoundError("Organization not found in projection"));
    return ok({ organizationId: org.organizationId, slug: org.slug, tenant: org.orgTenant });
  }
}

export interface ResolveMachineIdentityInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
}
export interface MachineIdentityResolution {
  readonly principalRef: string;
  readonly owner: string;
  readonly purpose: string;
  readonly status: string;
  readonly allowedScopes: readonly string[];
  readonly allowedEnvironments: readonly string[];
}

/** Resolves a Security-owned machine identity's governance profile (Security owns non-human identity). */
export class ResolveMachineIdentity implements UseCase<
  ResolveMachineIdentityInput,
  MachineIdentityResolution,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: ResolveMachineIdentityInput,
  ): Promise<Result<MachineIdentityResolution, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    const profile = await this.deps.machineProfiles.findByPrincipal(
      principal.id.toString(),
      input.tenantId,
    );
    if (profile === null) return err(new NotFoundError("Machine identity is not governed"));
    return ok({
      principalRef: profile.principalRef,
      owner: profile.owner,
      purpose: profile.purpose,
      status: profile.status,
      allowedScopes: profile.allowedScopes,
      allowedEnvironments: profile.allowedEnvironments,
    });
  }
}
