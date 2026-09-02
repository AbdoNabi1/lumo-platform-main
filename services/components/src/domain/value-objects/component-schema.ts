import { ValueObject } from "@platform/domain";

export interface ComponentProperty {
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "object" | "array";
  readonly required: boolean;
}

interface ComponentSchemaProps {
  readonly properties: readonly ComponentProperty[];
  readonly defaults: Readonly<Record<string, unknown>>;
}

/** The schema-driven property contract of a component — any component is data, not code. */
export class ComponentSchema extends ValueObject<ComponentSchemaProps> {
  static create(
    properties: readonly ComponentProperty[],
    defaults: Readonly<Record<string, unknown>> = {},
  ): ComponentSchema {
    return new ComponentSchema({ properties, defaults });
  }

  get properties(): readonly ComponentProperty[] {
    return this.props.properties;
  }

  get defaults(): Readonly<Record<string, unknown>> {
    return this.props.defaults;
  }
}
