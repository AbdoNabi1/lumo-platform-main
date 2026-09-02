import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { ComponentTransitioned } from "./events/component-transitioned.event";
import type { ComponentContract } from "./value-objects/component-contract";
import type { ComponentSchema } from "./value-objects/component-schema";

export type ComponentStatusValue = "draft" | "published" | "deprecated" | "archived";

const TRANSITIONS: Readonly<Record<ComponentStatusValue, readonly ComponentStatusValue[]>> = {
  draft: ["published", "archived"],
  published: ["deprecated", "archived"],
  deprecated: ["archived"],
  archived: [],
};

interface ComponentDefinitionProps {
  readonly key: string;
  readonly name: string;
  readonly schema: ComponentSchema;
  readonly contract: ComponentContract;
  readonly featureFlagKey?: string;
  status: ComponentStatusValue;
}

/**
 * The schema-driven rendering contract for one component (Sprint 5.4) — any current or future
 * component is data, not code. Experience owns instances only; this owns the contract.
 */
export class ComponentDefinition extends AggregateRoot<ComponentDefinitionProps> {
  static create(
    id: UniqueEntityId,
    key: string,
    name: string,
    schema: ComponentSchema,
    contract: ComponentContract,
    featureFlagKey?: string,
  ): ComponentDefinition {
    return new ComponentDefinition(
      { key, name, schema, contract, featureFlagKey, status: "draft" },
      id,
    );
  }

  static reconstitute(
    id: UniqueEntityId,
    key: string,
    name: string,
    schema: ComponentSchema,
    contract: ComponentContract,
    status: ComponentStatusValue,
    version: number,
    featureFlagKey?: string,
  ): ComponentDefinition {
    return new ComponentDefinition(
      { key, name, schema, contract, featureFlagKey, status },
      id,
      version,
    );
  }

  transition(toStatus: ComponentStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status;
    if (!TRANSITIONS[fromStatus].includes(toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition component from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = toStatus;
    this.addDomainEvent(
      new ComponentTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          key: this.props.key,
          action: toStatus,
        },
      ),
    );
  }

  publish(eventId: string, occurredAt: Date): void {
    this.transition("published", eventId, occurredAt);
  }

  deprecate(eventId: string, occurredAt: Date): void {
    this.transition("deprecated", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  get key(): string {
    return this.props.key;
  }

  get name(): string {
    return this.props.name;
  }

  get schema(): ComponentSchema {
    return this.props.schema;
  }

  get contract(): ComponentContract {
    return this.props.contract;
  }

  get featureFlagKey(): string | undefined {
    return this.props.featureFlagKey;
  }

  get status(): ComponentStatusValue {
    return this.props.status;
  }
}
