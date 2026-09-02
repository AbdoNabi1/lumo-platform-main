import type { ClickHouseClient } from "@clickhouse/client";
import type { HealthCheck } from "@platform/health";

/** ClickHouse health probe via the client's ping. */
export function createClickHouseHealthCheck(client: ClickHouseClient): HealthCheck {
  return {
    name: "clickhouse",
    async probe(): Promise<void> {
      const result = await client.ping();
      if (!result.success) {
        throw result.error;
      }
    },
  };
}
