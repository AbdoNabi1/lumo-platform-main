import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";
import {
  isHumanKind,
  type PrincipalKind,
  type PrincipalStatus,
} from "./value-objects/principal-kind";

const TRANSITIONS: Readonly<Record<PrincipalStatus, readonly PrincipalStatus[]>> = {
  active: ["suspended", "disabled"],
  suspended: ["active", "disabled"],
  disabled: [],
};

interface PrincipalProps {
  readonly externalId: string;
  readonly kind: PrincipalKind;
  displayName: string;
  /** For `human` principals only: the Identity-context user id this references. Non-human ⇒ null. */
  readonly subjectRef: string | null;
  /** Owning tenant, or null for platform-level principals (ADR-0008). */
  readonly tenantRef: string | null;
  status: PrincipalStatus;
  /** Non-PII attribute bag for ABAC (e.g. `department`, `clearance`). Never holds secrets/PII. */
  attributes: Record<string, string>;
}

/**
 * The **unified identity** — a security principal. `human` principals are a reference to an Identity
 * user (`subjectRef`); Security stores no human PII. Every non-human kind (service account, machine,
 * api_key, robot, partner, marketplace, ai) is fully owned here. Credentials and sessions are
 * separate aggregates bound to a principal by id (ADR-0023).
 */
export class Principal extends AggregateRoot<PrincipalProps> {
  static register(
    id: UniqueEntityId,
    input: {
      readonly externalId: string;
      readonly kind: PrincipalKind;
      readonly displayName: string;
      readonly subjectRef?: string | null;
      readonly tenantRef?: string | null;
      readonly attributes?: Readonly<Record<string, string>>;
    },
    eventId: string,
    occurredAt: Date,
  ): Principal {
    if (input.externalId.trim().length === 0)
      throw new BusinessRuleError("A principal needs an externalId");
    if (input.displayName.trim().length === 0)
      throw new BusinessRuleError("A principal needs a display name");
    const subjectRef = input.subjectRef ?? null;
    if (isHumanKind(input.kind) && subjectRef === null) {
      throw new BusinessRuleError(
        "A human principal must reference an Identity subject (subjectRef)",
      );
    }
    if (!isHumanKind(input.kind) && subjectRef !== null) {
      throw new BusinessRuleError("A non-human principal cannot carry a human subjectRef");
    }
    const principal = new Principal(
      {
        externalId: input.externalId.trim(),
        kind: input.kind,
        displayName: input.displayName.trim(),
        subjectRef,
        tenantRef: input.tenantRef ?? null,
        status: "active",
        attributes: { ...(input.attributes ?? {}) },
      },
      id,
    );
    principal.emit("security.principal.registered", eventId, occurredAt);
    return principal;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: {
      readonly externalId: string;
      readonly kind: PrincipalKind;
      readonly displayName: string;
      readonly subjectRef: string | null;
      readonly tenantRef: string | null;
      readonly status: PrincipalStatus;
      readonly attributes: Readonly<Record<string, string>>;
      readonly version: number;
    },
  ): Principal {
    return new Principal(
      {
        externalId: base.externalId,
        kind: base.kind,
        displayName: base.displayName,
        subjectRef: base.subjectRef,
        tenantRef: base.tenantRef,
        status: base.status,
        attributes: { ...base.attributes },
      },
      id,
      base.version,
    );
  }

  suspend(eventId: string, occurredAt: Date): void {
    this.transition("suspended", "security.principal.suspended", eventId, occurredAt);
  }

  activate(eventId: string, occurredAt: Date): void {
    if (this.props.status === "active") throw new BusinessRuleError("Principal is already active");
    this.transition("active", "security.principal.activated", eventId, occurredAt);
  }

  disable(eventId: string, occurredAt: Date): void {
    this.transition("disabled", "security.principal.disabled", eventId, occurredAt);
  }

  get externalId(): string {
    return this.props.externalId;
  }
  get kind(): PrincipalKind {
    return this.props.kind;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get subjectRef(): string | null {
    return this.props.subjectRef;
  }
  get tenantRef(): string | null {
    return this.props.tenantRef;
  }
  get status(): PrincipalStatus {
    return this.props.status;
  }
  get attributes(): Readonly<Record<string, string>> {
    return this.props.attributes;
  }
  get isActive(): boolean {
    return this.props.status === "active";
  }

  private transition(
    to: PrincipalStatus,
    event: SecurityEventName,
    eventId: string,
    occurredAt: Date,
  ): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new BusinessRuleError(
        `Principal cannot transition from "${this.props.status}" to "${to}"`,
      );
    }
    this.props.status = to;
    this.emit(event, eventId, occurredAt);
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "principal",
          key: this.props.externalId,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
