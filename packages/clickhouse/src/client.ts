import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseConfig } from "@platform/config/server";

export type ClickHouse = ClickHouseClient;

export interface ClickHouseClientOptions {
  readonly requestTimeoutMs?: number;
  readonly maxOpenConnections?: number;
}

/**
 * Creates a ClickHouse client (dependency-injected config). Bounded connections + request
 * timeout form the connection/retry policy; the client retries idempotent reads internally.
 */
export function createClickHouseClient(
  config: ClickHouseConfig,
  options: ClickHouseClientOptions = {},
): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    request_timeout: options.requestTimeoutMs ?? 30_000,
    max_open_connections: options.maxOpenConnections ?? 10,
    keep_alive: { enabled: true },
  });
}
