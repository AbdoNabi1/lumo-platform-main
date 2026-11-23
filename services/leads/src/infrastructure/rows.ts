import type { Prisma } from "@platform/db";

/** The columns of `leads.leads` as Prisma returns them (structurally the generated `Lead` model). */
export interface LeadRow {
  readonly id: string;
  readonly tenantId: string;
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly message: string | null;
  readonly status: string;
  readonly trackingStatus: string;
  readonly eventId: string;
  readonly sessionId: string;
  readonly submissionKey: string;
  readonly spamReason: string | null;
  readonly attribution: unknown;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** Prisma's unique-violation code (same idiom as services/online-store): a concurrent insert lost a race. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

const SUBMISSION_KEY_INDEX = "leads_tenant_id_submission_key_key";

/**
 * A P2002 on the `(tenant_id, submission_key)` unique index only. A clash on any other constraint
 * (the primary key) is a bug and must surface, not be answered as "already submitted".
 */
export function isSubmissionKeyViolation(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const parts: unknown[] = Array.isArray(target) ? target : [target];
  return parts.some(
    (part) =>
      typeof part === "string" &&
      (part === "submission_key" ||
        part === "submissionKey" ||
        part.includes(SUBMISSION_KEY_INDEX)),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `id` column is a uuid: any other string would make Postgres throw instead of finding nothing. */
export const isUuid = (value: string): boolean => UUID.test(value);
