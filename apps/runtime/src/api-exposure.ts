import type { RuntimeConfig } from "./config";

/** What `createAdminHttpApi` is told about the unauthenticated diagnostic surface. */
export interface ApiExposure {
  readonly exposeDocs: boolean;
  readonly readinessDetail: "full" | "status-only";
  readonly metricsAccess: "open" | "closed" | { readonly bearerToken: string };
}

/**
 * G-82: decides whether this process serves its OpenAPI spec, docs UI, `/readyz` dependency detail
 * and `/metrics` to anonymous callers.
 *
 * This used to be `APP_ENV === "local"`, but `local` is also the only `APP_ENV` a deployment can boot
 * with today (the MFA / payments / object-storage / signup-email / dunning / integration-port guards
 * in `api.ts` refuse every other value), so a public Railway domain was the "local" case and exposed
 * all of it. `APP_ENV` cannot tell a laptop from a container, so the container image's own marker is
 * used instead: `runtime.Dockerfile` sets `NODE_ENV=production`, a developer running `tsx` does not.
 *
 * Open only when `APP_ENV=local` AND not a production container — or when `EXPOSE_API_DIAGNOSTICS`
 * says so explicitly (config refuses `true` outside `APP_ENV=local`). Closed, `/metrics` is served
 * to a bearer token when `METRICS_TOKEN` is set, and not at all otherwise.
 */
export function resolveApiExposure(
  config: Pick<RuntimeConfig, "APP_ENV" | "EXPOSE_API_DIAGNOSTICS" | "METRICS_TOKEN">,
  nodeEnv: string | undefined,
): ApiExposure {
  const open =
    config.EXPOSE_API_DIAGNOSTICS ?? (config.APP_ENV === "local" && nodeEnv !== "production");
  if (open) return { exposeDocs: true, readinessDetail: "full", metricsAccess: "open" };
  return {
    exposeDocs: false,
    readinessDetail: "status-only",
    metricsAccess:
      config.METRICS_TOKEN === undefined ? "closed" : { bearerToken: config.METRICS_TOKEN },
  };
}
