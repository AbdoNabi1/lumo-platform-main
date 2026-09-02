import type { Metric } from "../domain/semantic-model";
import { VersionedCatalog } from "./versioned-catalog";

/** The governed catalog of every {@link Metric} (base or calculated), canonical-id-versioned. */
export class MetricCatalog extends VersionedCatalog<Metric> {}
