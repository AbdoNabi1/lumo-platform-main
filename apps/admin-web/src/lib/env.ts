/**
 * Fail-closed environment resolution (Phase A.34 — A.33 P0 #3/#7). Edge-safe: no `node:*` imports,
 * so both `middleware.ts` (Edge runtime) and the Node-only `lib/auth/config.ts`/`lib/api/client.ts`
 * can import this without crossing the module-boundary concern `middleware.ts` used to document
 * (it previously duplicated these same reads instead of sharing a module for that reason — this
 * file has zero Node dependencies, so there is nothing left to duplicate for).
 *
 * `local`/`development` keep today's `localhost` defaults (`pnpm dev` needs no env file). Every
 * other `APP_ENV` throws at import time instead of silently resolving to `localhost` or a
 * placeholder secret — the exact A.33 finding: "a misconfigured production deploy doesn't fail to
 * boot, it silently targets localhost... then fails opaquely at request time."
 */
function isDevLike(): boolean {
  const appEnv = process.env["APP_ENV"] ?? "local";
  return appEnv === "local" || appEnv === "development";
}

/** A required var with a `localhost`/placeholder default that must NOT be used outside dev. */
export function requireProdEnv(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value !== undefined && value.length > 0) return value;
  if (isDevLike()) return devDefault;
  throw new Error(
    `Missing production environment variable: ${name}. No localhost/placeholder fallback is used ` +
      `outside APP_ENV=local|development (Phase A.34 — A.33 P0 #3/#7).`,
  );
}

/** A var that's safe to default anywhere (non-secret, non-URL identifier). */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : fallback;
}
