import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface OrganizationCreatedData {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
}

/** Raised when an organization is created within a tenant. */
export class OrganizationCreated extends DomainEvent {
  readonly eventName = "organization.created";
  readonly data: OrganizationCreatedData;

  constructor(props: DomainEventProps, data: OrganizationCreatedData) {
    super(props);
    this.data = data;
  }
}
