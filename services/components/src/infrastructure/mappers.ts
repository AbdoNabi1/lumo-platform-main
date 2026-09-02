import { UniqueEntityId } from "@platform/domain";
import { ComponentDefinition, type ComponentStatusValue } from "../domain/component-definition";
import { ComponentContract } from "../domain/value-objects/component-contract";
import { ComponentSchema, type ComponentProperty } from "../domain/value-objects/component-schema";

export interface ComponentDefinitionRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly properties: readonly ComponentProperty[];
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly slots: readonly string[];
  readonly events: readonly string[];
  readonly responsive: boolean;
  readonly permission: string | null;
  readonly featureFlagKey: string | null;
  readonly status: string;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link ComponentDefinition}. Mapping only — no I/O. */
export class ComponentDefinitionMapper {
  static toDomain(row: ComponentDefinitionRow): ComponentDefinition {
    return ComponentDefinition.reconstitute(
      UniqueEntityId.from(row.id),
      row.key,
      row.name,
      ComponentSchema.create(row.properties, row.defaults),
      ComponentContract.create({
        slots: row.slots,
        events: row.events,
        responsive: row.responsive,
        permission: row.permission ?? undefined,
      }),
      row.status as ComponentStatusValue,
      row.version,
      row.featureFlagKey ?? undefined,
    );
  }

  static toRow(definition: ComponentDefinition, tenantId: string) {
    return {
      id: definition.id.toString(),
      tenantId,
      key: definition.key,
      name: definition.name,
      properties: definition.schema.properties,
      defaults: definition.schema.defaults,
      slots: definition.contract.slots,
      events: definition.contract.events,
      responsive: definition.contract.responsive,
      permission: definition.contract.permission ?? null,
      featureFlagKey: definition.featureFlagKey ?? null,
      status: definition.status,
      version: 1,
    };
  }
}
