import { assertStorefrontProductionEnv, missingStorefrontEnv } from "./lib/storefront-env";

/**
 * Next calls this once per server start. A production storefront without its secrets does not boot.
 *
 * Some deployments run a production build with APP_ENV=local (see infrastructure/railway/README.md),
 * where the assertion above is silent by design. There the missing names are logged instead, so the
 * gap shows up in the deploy logs (names only, never values).
 */
export function register(): void {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  assertStorefrontProductionEnv();
  if (process.env["NODE_ENV"] !== "production") return;
  const missing = missingStorefrontEnv();
  if (missing.length > 0) {
    console.error(
      `storefront: production build with a development-like APP_ENV is missing: ${missing.join(", ")}; the unlock cookie, revalidation and preview framing stay off until they are set`,
    );
  }
}
