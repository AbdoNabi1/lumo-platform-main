import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import type { CanonicalId } from "./value-objects/canonical-id";

interface ReadModelDescriptorProps {
  readonly id: CanonicalId;
  readonly fields: readonly string[];
  /** Field every row is keyed by — the join key `SemanticEngine` joins across read models on. */
  readonly dimensionKey: string;
}

/**
 * Describes one business-owned read model as Analytics is allowed to see it: its canonical id
 * (used to look up an {@link AnalyticsReadStore} table), the physical field names it exposes, and
 * the field rows from every read model are joined on. Analytics never imports the owning
 * context — this descriptor, registered by that context (e.g. `registerFinanceSemantics`), is
 * the entire contract.
 */
export class ReadModelDescriptor extends ValueObject<ReadModelDescriptorProps> {
  static define(
    id: CanonicalId,
    fields: readonly string[],
    dimensionKey: string,
  ): Result<ReadModelDescriptor, ValidationError> {
    if (fields.length === 0) {
      return err(
        new ValidationError("Invalid read model descriptor", [
          { field: "fields", message: "must declare at least one field" },
        ]),
      );
    }
    if (!fields.includes(dimensionKey)) {
      return err(
        new ValidationError("Invalid read model descriptor", [
          { field: "dimensionKey", message: "must be one of the declared fields" },
        ]),
      );
    }
    return ok(new ReadModelDescriptor({ id, fields: [...fields], dimensionKey }));
  }

  get id(): CanonicalId {
    return this.props.id;
  }

  get fields(): readonly string[] {
    return this.props.fields;
  }

  get dimensionKey(): string {
    return this.props.dimensionKey;
  }

  hasField(field: string): boolean {
    return this.props.fields.includes(field);
  }
}
