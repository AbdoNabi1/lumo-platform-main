import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { UserCreated } from "./events/user-created.event";
import { UserDeactivated } from "./events/user-deactivated.event";
import { UserUpdated } from "./events/user-updated.event";
import type { Email } from "./value-objects/email";

export type UserStatus = "active" | "deactivated";

interface UserProps {
  readonly tenantId: string;
  readonly email: Email;
  name: string;
  status: UserStatus;
}

/**
 * A user within a tenant (Option A, Sprint 4.1): identity only — no roles/permissions (Keto,
 * ADR-0007/0023) and no tenancy engine (ADR-0008; `tenantId` is a bare reference). Reuses the
 * Customer vertical's `Email` value object.
 */
export class User extends AggregateRoot<UserProps> {
  static create(
    id: UniqueEntityId,
    tenantId: string,
    email: Email,
    name: string,
    eventId: string,
    occurredAt: Date,
  ): User {
    const user = new User({ tenantId, email, name, status: "active" }, id);
    user.addDomainEvent(
      new UserCreated(
        { eventId, aggregateId: user.id, occurredAt },
        { tenantId, email: email.value },
      ),
    );
    return user;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantId: string,
    email: Email,
    name: string,
    status: UserStatus,
    version: number,
  ): User {
    return new User({ tenantId, email, name, status }, id, version);
  }

  rename(name: string, eventId: string, occurredAt: Date): void {
    this.props.name = name;
    this.addDomainEvent(
      new UserUpdated(
        { eventId, aggregateId: this.id, occurredAt },
        { tenantId: this.props.tenantId },
      ),
    );
  }

  deactivate(eventId: string, occurredAt: Date): void {
    if (this.props.status === "deactivated") {
      throw new BusinessRuleError("User is already deactivated");
    }
    this.props.status = "deactivated";
    this.addDomainEvent(
      new UserDeactivated(
        { eventId, aggregateId: this.id, occurredAt },
        { tenantId: this.props.tenantId },
      ),
    );
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get email(): Email {
    return this.props.email;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get isActive(): boolean {
    return this.props.status === "active";
  }
}
