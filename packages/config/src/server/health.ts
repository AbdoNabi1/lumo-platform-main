import type { HealthCheck } from "@platform/health";
import type { AppConfig } from "./config";

/**
 * Configuration health probe: asserts the loaded config has all required infrastructure
 * endpoints. Configuration is validated at load (fail-fast); this is a liveness assertion.
 */
export function createConfigHealthCheck(config: AppConfig): HealthCheck {
  return {
    name: "configuration",
    probe(): Promise<void> {
      const complete =
        config.database.url.length > 0 &&
        config.redis.url.length > 0 &&
        config.clickhouse.url.length > 0 &&
        config.storage.endpoint.length > 0;
      return complete
        ? Promise.resolve()
        : Promise.reject(new Error("Incomplete infrastructure configuration"));
    },
  };
}
