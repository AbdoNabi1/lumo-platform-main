import { Prisma } from "@prisma/client";

/** The columns of `tracking.ad_platform_connections` as Prisma returns them (structurally the generated model). */
export interface AdPlatformConnectionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly platform: string;
  readonly enabled: boolean;
  readonly publicConfig: unknown;
  readonly sealedSecret: string | null;
  readonly secretLast4: string | null;
  readonly testEventCode: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A nullable Json column is written as SQL NULL, never as the JSON literal `null`. */
export function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** Prisma's unique-violation code (same idiom as services/leads): a concurrent insert lost a race. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

const PLATFORM_INDEX = "ad_platform_connections_tenant_id_platform_key";
const PLATFORM_COLUMNS: readonly string[] = ["tenant_id", "platform"];

/**
 * A P2002 on the `(tenant_id, platform)` unique index only: `meta.target` must be exactly the column
 * tuple `["tenant_id", "platform"]` (the index's column order, which is how Prisma reports it) or
 * exactly the index name. A clash on anything else (the primary key, a partial or different tuple, a
 * string that merely contains the name) is a bug and must surface, not be answered as "someone else
 * saved first".
 */
export function isPlatformKeyViolation(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (typeof target === "string") return target === PLATFORM_INDEX;
  return (
    Array.isArray(target) &&
    target.length === PLATFORM_COLUMNS.length &&
    PLATFORM_COLUMNS.every((column, i) => target[i] === column)
  );
}
