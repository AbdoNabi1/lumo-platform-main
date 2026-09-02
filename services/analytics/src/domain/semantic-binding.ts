import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import type { CanonicalId } from "./value-objects/canonical-id";

interface SemanticBindingProps {
  readonly readModelId: CanonicalId;
  readonly physicalField: string;
}

/**
 * Binds a canonical field (a measure's or dimension's own canonical id) to the physical field
 * name on a business-owned read model. This is the *only* place a canonical id is ever mapped to
 * a concrete field — `QueryCompiler` reads bindings to build safe queries; it never invents or
 * string-concatenates a physical field name itself.
 */
export class SemanticBinding extends ValueObject<SemanticBindingProps> {
  static define(
    readModelId: CanonicalId,
    physicalField: string,
  ): Result<SemanticBinding, ValidationError> {
    if (physicalField.trim().length === 0) {
      return err(
        new ValidationError("Invalid semantic binding", [
          { field: "physicalField", message: "must not be empty" },
        ]),
      );
    }
    return ok(new SemanticBinding({ readModelId, physicalField }));
  }

  get readModelId(): CanonicalId {
    return this.props.readModelId;
  }

  get physicalField(): string {
    return this.props.physicalField;
  }
}
