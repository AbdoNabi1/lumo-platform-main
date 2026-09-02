import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import type { CanonicalId } from "./value-objects/canonical-id";
import type { SemanticBinding } from "./semantic-binding";

interface DimensionDefinitionProps {
  readonly id: CanonicalId;
  readonly label: string;
  readonly binding: SemanticBinding;
}

/** A groupable/filterable attribute — the non-numeric counterpart to {@link Measure}. */
export class DimensionDefinition extends ValueObject<DimensionDefinitionProps> {
  static define(
    id: CanonicalId,
    label: string,
    binding: SemanticBinding,
  ): Result<DimensionDefinition, ValidationError> {
    if (label.trim().length === 0) {
      return err(
        new ValidationError("Invalid dimension definition", [
          { field: "label", message: "must not be empty" },
        ]),
      );
    }
    return ok(new DimensionDefinition({ id, label, binding }));
  }

  get id(): CanonicalId {
    return this.props.id;
  }

  get label(): string {
    return this.props.label;
  }

  get binding(): SemanticBinding {
    return this.props.binding;
  }
}
