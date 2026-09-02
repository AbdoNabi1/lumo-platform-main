import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseConfig } from "@platform/config/server";
import type { HealthCheck } from "@platform/health";
import { createClickHouseClient, type ClickHouseClientOptions } from "./client";
import { createClickHouseHealthCheck } from "./health";

export { type ClickHouse, type ClickHouseClientOptions, createClickHouseClient } from "./client";
export { createClickHouseHealthCheck } from "./health";

/** A managed ClickHouse handle: client, health probe, and lifecycle. */
export interface ClickHouseHandle {
  readonly client: ClickHouseClient;
  healthCheck(): HealthCheck;
  disconnect(): Promise<void>;
}

/** Composition root for the ClickHouse infrastructure (dependency-injected config). */
export function createClickHouse(
  config: ClickHouseConfig,
  options: ClickHouseClientOptions = {},
): ClickHouseHandle {
  const client = createClickHouseClient(config, options);
  return {
    client,
    healthCheck: () => createClickHouseHealthCheck(client),
    disconnect: () => client.close(),
  };
}
