import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ThemeTransitioned } from "./events/theme-transitioned.event";
import { ThemeVersion } from "./theme-version";
import type { ThemeVariables } from "./value-objects/theme-variables";

export type ThemeStatusValue = "draft" | "active" | "archived";

const TRANSITIONS: Readonly<Record<ThemeStatusValue, readonly ThemeStatusValue[]>> = {
  draft: ["active", "archived"],
  active: ["archived"],
  archived: [],
};

interface ThemeProps {
  readonly name: string;
  variables: ThemeVariables;
  status: ThemeStatusValue;
  readonly versions: ThemeVersion[];
}

/** Source of truth for one theme's appearance (Sprint 5.4). Seeds from `@platform/design` tokens (never duplicates them). */
export class Theme extends AggregateRoot<ThemeProps> {
  static create(id: UniqueEntityId, name: string, variables: ThemeVariables): Theme {
    return new Theme({ name, variables, status: "draft", versions: [] }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    variables: ThemeVariables,
    status: ThemeStatusValue,
    version: number,
    versions: readonly ThemeVersion[] = [],
  ): Theme {
    return new Theme({ name, variables, status, versions: [...versions] }, id, version);
  }

  transition(toStatus: ThemeStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status;
    if (!TRANSITIONS[fromStatus].includes(toStatus)) {
      throw new BusinessRuleError(`Cannot transition theme from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = toStatus;
    if (toStatus === "active") {
      this.props.versions.push(
        ThemeVersion.create(
          UniqueEntityId.from(this.id.toString() + this.props.versions.length),
          this.props.versions.length + 1,
          this.props.variables,
          occurredAt,
        ),
      );
    }
    this.raise(toStatus, eventId, occurredAt);
  }

  publish(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  updateVariables(variables: ThemeVariables): void {
    if (this.props.status === "archived") {
      throw new BusinessRuleError("Cannot edit an archived theme");
    }
    this.props.variables = variables;
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new ThemeTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        { name: this.props.name, action },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get variables(): ThemeVariables {
    return this.props.variables;
  }

  get status(): ThemeStatusValue {
    return this.props.status;
  }

  get versions(): readonly ThemeVersion[] {
    return this.props.versions;
  }
}
