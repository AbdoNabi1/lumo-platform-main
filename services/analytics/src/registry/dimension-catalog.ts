import type { DimensionDefinition } from "../domain/dimension-definition";
import { VersionedCatalog } from "./versioned-catalog";

/** The governed catalog of every {@link DimensionDefinition}, canonical-id-versioned. */
export class DimensionCatalog extends VersionedCatalog<DimensionDefinition> {}
