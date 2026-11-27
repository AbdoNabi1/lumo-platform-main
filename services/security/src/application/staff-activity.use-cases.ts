import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { AuditRecord } from "../domain/audit-record";
import type { StaffDeps } from "./deps";
import { loadStaffDirectory, STAFF_IDENTIFIER_PREFIX, type StaffDirectory } from "./staff-support";

/*
 * Wave 1e — the staff activity list: a paged, newest-first view of the tenant's audit ledger,
 * restricted to a server-side allow-list of actions and mapped to a small vocabulary. It never
 * exposes raw metadata, hashes or sequence numbers, and never re-verifies a chain (the ledger is
 * chained per scope; this read crosses scopes).
 */

export type StaffActivityKind =
  | "signed_in"
  | "sign_in_failed"
  | "code_failed"
  | "invited"
  | "invitation_accepted"
  | "invitation_revoked"
  | "role_changed"
  | "deactivated"
  | "reactivated"
  | "two_step_on"
  | "two_step_off"
  | "backup_codes_regenerated"
  | "two_step_policy_changed"
  | "two_step_reset";

export interface StaffActivityItem {
  readonly id: string;
  readonly at: string;
  readonly kind: StaffActivityKind;
  readonly actorEmail: string | null;
  readonly subjectEmail: string | null;
  readonly detail: { readonly from?: string; readonly to?: string; readonly enabled?: boolean };
}

export interface ListStaffActivityInput {
  readonly tenantId: string;
  /** Only rows whose subject is this member (externalId; every ref form the member appears under). */
  readonly memberExternalId?: string;
  readonly cursor?: string;
  /** 1..50, default 25. */
  readonly limit?: number;
}

export interface ListStaffActivityOutput {
  readonly items: readonly StaffActivityItem[];
  readonly nextCursor: string | null;
}

export const DEFAULT_ACTIVITY_LIMIT = 25;
export const MAX_ACTIVITY_LIMIT = 50;
/** Rows read per ledger page and the most pages one request scans (skipped rows cost a page each). */
const SCAN_BATCH = 100;
const SCAN_MAX_BATCHES = 20;

/** The action allow-list → kind. `security.auth.succeeded` is handled separately (needs `metadata.mfa`). */
const KIND_BY_ACTION: Readonly<Record<string, StaffActivityKind>> = {
  "security.mfa.login_verified": "signed_in",
  "security.auth.succeeded": "signed_in",
  "security.auth.failed": "sign_in_failed",
  "security.mfa.login_failed": "code_failed",
  "security.staff.invited": "invited",
  "security.staff.invitation_accepted": "invitation_accepted",
  "security.staff.invitation_revoked": "invitation_revoked",
  "security.staff.role_changed": "role_changed",
  "security.staff.deactivated": "deactivated",
  "security.staff.reactivated": "reactivated",
  "security.staff.two_step_policy_changed": "two_step_policy_changed",
  "security.staff.two_step_reset": "two_step_reset",
  "security.mfa.enabled": "two_step_on",
  "security.mfa.disabled": "two_step_off",
  "security.mfa.backup_codes_regenerated": "backup_codes_regenerated",
};
const ACTIONS: readonly string[] = Object.keys(KIND_BY_ACTION);

const invalidField = (field: string, summary: string): ValidationError =>
  new ValidationError(summary, [{ field, message: summary }]);

interface Cursor {
  readonly occurredAt: string;
  readonly id: string;
}

const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify({ occurredAt: c.occurredAt, id: c.id }), "utf8").toString("base64url");

/** `null` for anything that is not exactly what {@link encodeCursor} produces. */
function decodeCursor(raw: string): Cursor | null {
  if (raw.length === 0 || raw.length > 500 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { occurredAt, id } = parsed as Record<string, unknown>;
    if (typeof occurredAt !== "string" || typeof id !== "string") return null;
    if (Number.isNaN(Date.parse(occurredAt)) || id.length === 0 || id.length > 64) return null;
    return { occurredAt, id };
  } catch {
    return null;
  }
}

/** Who a ref points at: a staff email when it resolves, plus the externalId when known. */
interface Resolver {
  /** The email behind a principalRef (externalId, internal id or `staff:<email>`); null = unknown. */
  emailOf(ref: string): string | null;
  /** Is the ref a staff member (or a `staff:` identifier)? */
  isStaffRef(ref: string): boolean;
}

function buildResolver(directory: StaffDirectory): Resolver {
  const externalIdByInternal = new Map<string, string>();
  for (const p of directory.principals.values()) externalIdByInternal.set(p.id, p.externalId);
  const staffExternalId = (ref: string): string | null => {
    if (directory.staff.has(ref)) return ref;
    const viaInternal = externalIdByInternal.get(ref);
    return viaInternal !== undefined && directory.staff.has(viaInternal) ? viaInternal : null;
  };
  return {
    emailOf(ref) {
      if (ref.startsWith(STAFF_IDENTIFIER_PREFIX)) return ref.slice(STAFF_IDENTIFIER_PREFIX.length);
      const externalId = staffExternalId(ref);
      return externalId === null ? null : (directory.staff.get(externalId)?.email ?? null);
    },
    isStaffRef: (ref) => ref.startsWith(STAFF_IDENTIFIER_PREFIX) || staffExternalId(ref) !== null,
  };
}

/** Every principalRef form a member's rows can carry. */
function refsOfMember(directory: StaffDirectory, memberExternalId: string): readonly string[] {
  const refs = new Set<string>([memberExternalId]);
  const summary = directory.principals.get(memberExternalId);
  if (summary !== undefined) refs.add(summary.id);
  const email = directory.staff.get(memberExternalId)?.email;
  if (email !== undefined) refs.add(`${STAFF_IDENTIFIER_PREFIX}${email}`);
  return [...refs];
}

/**
 * One ledger row → an activity item, or `null` when it is not shown: a password-correct sign-in that
 * still waits for its code (`mfa: "required"`; the verify row follows), a customer's sign-in, or a
 * non-staff failed-login identifier.
 */
async function toItem(
  record: AuditRecord,
  resolver: Resolver,
  invitationEmail: (invitationId: string | undefined) => Promise<string | null>,
): Promise<StaffActivityItem | null> {
  const { action, principalRef, metadata, occurredAt } = record.content;
  const kind = KIND_BY_ACTION[action];
  if (kind === undefined) return null;
  if (action === "security.auth.succeeded" && metadata["mfa"] === "required") return null;
  if (action === "security.auth.failed" && !principalRef.startsWith(STAFF_IDENTIFIER_PREFIX))
    return null;
  // A customer's (or any non-staff principal's) successful sign-in never appears.
  if (action === "security.auth.succeeded" && !resolver.isStaffRef(principalRef)) return null;

  let subjectEmail = resolver.emailOf(principalRef);
  if (subjectEmail === null && (kind === "invited" || kind === "invitation_revoked"))
    subjectEmail = await invitationEmail(metadata["invitationId"]);
  // The actor is the member itself for their own events; "invitee" / "system" / unknown stay unresolved.
  const actorRef = metadata["actor"];
  let actorEmail: string | null;
  if (actorRef === undefined || actorRef === "invitee") actorEmail = subjectEmail;
  else actorEmail = resolver.emailOf(actorRef);

  const detail: { from?: string; to?: string; enabled?: boolean } = {};
  if (kind === "role_changed") {
    if (metadata["from"] !== undefined) detail.from = metadata["from"];
    if (metadata["to"] !== undefined) detail.to = metadata["to"];
  } else if (kind === "invited") {
    if (metadata["role"] !== undefined) detail.to = metadata["role"];
  } else if (kind === "two_step_policy_changed") {
    detail.enabled = metadata["enabled"] === "true";
  }
  return { id: record.id, at: occurredAt, kind, actorEmail, subjectEmail, detail };
}

/**
 * Pages the activity list. Skipped rows (customers, waiting-for-code sign-ins) are stepped over in
 * batches until the page is full; the cursor then points at the last row of the page, or — when the
 * scan limit is hit with a short page — at the last row scanned, so paging always makes progress.
 */
export class ListStaffActivity implements UseCase<
  ListStaffActivityInput,
  ListStaffActivityOutput,
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: ListStaffActivityInput,
  ): Promise<Result<ListStaffActivityOutput, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const limit = input.limit ?? DEFAULT_ACTIVITY_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_LIMIT)
      return err(invalidField("limit", `limit must be between 1 and ${MAX_ACTIVITY_LIMIT}`));
    let before: Cursor | undefined;
    if (input.cursor !== undefined) {
      const decoded = decodeCursor(input.cursor);
      if (decoded === null) return err(invalidField("cursor", "cursor is not valid"));
      before = decoded;
    }

    const directory = await loadStaffDirectory(deps, tenantId, deps.clock.now());
    const resolver = buildResolver(directory);
    const principalRefs =
      input.memberExternalId === undefined
        ? undefined
        : refsOfMember(directory, input.memberExternalId);

    const invitationEmails = new Map<string, string | null>();
    const invitationEmail = async (invitationId: string | undefined): Promise<string | null> => {
      if (invitationId === undefined) return null;
      if (!invitationEmails.has(invitationId)) {
        const invitation = await deps.staffInvitations.findById(tenantId, invitationId);
        invitationEmails.set(invitationId, invitation?.email ?? null);
      }
      return invitationEmails.get(invitationId) ?? null;
    };

    const items: StaffActivityItem[] = [];
    let lastScanned: Cursor | null = null;
    let lastOfPage: Cursor | null = null;
    let exhausted = false;
    let more = false;
    let cursor: Cursor | undefined = before;
    for (let batch = 0; batch < SCAN_MAX_BATCHES && !more; batch += 1) {
      const rows = await deps.auditLedger.listForTenant({
        tenantId,
        actions: ACTIONS,
        ...(principalRefs === undefined ? {} : { principalRefs }),
        ...(cursor === undefined ? {} : { before: cursor }),
        limit: SCAN_BATCH,
      });
      for (const row of rows) {
        lastScanned = { occurredAt: row.content.occurredAt, id: row.id };
        const item = await toItem(row, resolver, invitationEmail);
        if (item === null) continue;
        if (items.length === limit) {
          more = true; // a further visible row exists: the page has a successor
          break;
        }
        items.push(item);
        lastOfPage = lastScanned;
      }
      if (rows.length < SCAN_BATCH) {
        exhausted = true;
        break;
      }
      cursor = lastScanned ?? undefined;
    }
    let next: Cursor | null = null;
    if (more) next = lastOfPage;
    else if (!exhausted) next = lastScanned;
    return ok({ items, nextCursor: next === null ? null : encodeCursor(next) });
  }
}
