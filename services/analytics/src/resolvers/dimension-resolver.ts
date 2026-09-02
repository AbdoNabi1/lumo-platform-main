import { err, ok, type Result } from "@platform/types";
import { NotFoundError } from "@platform/utils";
import type { DimensionDefinition } from "../domain/dimension-definition";
import type { SemanticRegistry } from "../registry/semantic-registry";

export const DimensionResolver = {
  resolve(
    registry: SemanticRegistry,
    dimensionId: string,
  ): Result<DimensionDefinition, NotFoundError> {
    const dimension = registry.dimensions.get(dimensionId);
    return dimension
      ? ok(dimension)
      : err(new NotFoundError(`Dimension not found: ${dimensionId}`));
  },
} as const;
