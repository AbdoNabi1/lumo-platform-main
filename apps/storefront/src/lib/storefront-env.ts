export const MIN_SECRET_BYTES = 32;

type Env = Readonly<Record<string, string | undefined>>;

function secretOf(value: string | undefined): string | null {
  return value !== undefined && new TextEncoder().encode(value).length >= MIN_SECRET_BYTES
    ? value
    : null;
}

function originOf(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export interface StorefrontSecrets {
  readonly accessSecret: string | null;
  readonly revalidateSecret: string | null;
  readonly adminOrigin: string | null;
}

/** Read per call (never cached at module scope), never logged, never sent to the browser. */
export function storefrontSecrets(env: Env = process.env): StorefrontSecrets {
  return {
    accessSecret: secretOf(env["STOREFRONT_ACCESS_SECRET"]),
    revalidateSecret: secretOf(env["STOREFRONT_REVALIDATE_SECRET"]),
    adminOrigin: originOf(env["ADMIN_ORIGIN"]),
  };
}

function isDevLike(env: Env): boolean {
  const appEnv = env["APP_ENV"] ?? "local";
  return appEnv === "local" || appEnv === "development";
}

/** The names (never the values) of the production settings that are absent or too weak. */
export function missingStorefrontEnv(env: Env = process.env): readonly string[] {
  const s = storefrontSecrets(env);
  return [
    ...(s.accessSecret === null ? ["STOREFRONT_ACCESS_SECRET"] : []),
    ...(s.revalidateSecret === null ? ["STOREFRONT_REVALIDATE_SECRET"] : []),
    ...(s.adminOrigin === null ? ["ADMIN_ORIGIN"] : []),
  ];
}

/** Boot-time production assertion, like the runtime's `assertProduction*` (spec 1.5/1.12). */
export function assertStorefrontProductionEnv(env: Env = process.env): void {
  if (isDevLike(env)) return;
  const missing = missingStorefrontEnv(env);
  if (missing.length > 0) {
    throw new Error(
      `storefront: missing production configuration: ${missing.join(", ")} (secrets need at least ${MIN_SECRET_BYTES} bytes)`,
    );
  }
}
