import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { OrganizationCreated } from "./events/organization-created.event";
import type { OrganizationSlug } from "./value-objects/organization-slug";

export type OrganizationStatus = "active" | "archived";

interface OrganizationProps {
  readonly tenantId: string;
  readonly slug: OrganizationSlug;
  name: string;
  status: OrganizationStatus;
}

/**
 * An organization within a tenant — a grouping `Membership`s attach to. `archive` is a plain
 * state transition with no dedicated integration event: `SPRINT_4_1_IDENTITY_CORE_REPORT.md` §2
 * names exactly 6 domain events and none is an organization-archived event, so this milestone
 * does not invent one (Rule 12: no fabricated evidence).
 */
export class Organization extends AggregateRoot<OrganizationProps> {
  static create(
    id: UniqueEntityId,
    tenantId: string,
    slug: OrganizationSlug,
    name: string,
    eventId: string,
    occurredAt: Date,
  ): Organization {
    const organization = new Organization({ tenantId, slug, name, status: "active" }, id);
    organization.addDomainEvent(
      new OrganizationCreated(
        { eventId, aggregateId: organization.id, occurredAt },
        { tenantId, slug: slug.value, name },
      ),
    );
    return organization;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantId: string,
    slug: OrganizationSlug,
    name: string,
    status: OrganizationStatus,
    version: number,
  ): Organization {
    return new Organization({ tenantId, slug, name, status }, id, version);
  }

  archive(): void {
    if (this.props.status === "archived") {
      throw new BusinessRuleError("Organization is already archived");
    }
    this.props.status = "archived";
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get slug(): OrganizationSlug {
    return this.props.slug;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): OrganizationStatus {
    return this.props.status;
  }

  get isActive(): boolean {
    return this.props.status === "active";
  }
}
