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

/**
 * A P2002 on the `(tenant_id, platform)` unique index only. A clash on any other constraint (the
 * primary key) is a bug and must surface, not be answered as "someone else saved first".
 */
export function isPlatformKeyViolation(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const parts: unknown[] = Array.isArray(target) ? target : [target];
  return parts.some(
    (part) => typeof part === "string" && (part === "platform" || part.includes(PLATFORM_INDEX)),
  );
}
