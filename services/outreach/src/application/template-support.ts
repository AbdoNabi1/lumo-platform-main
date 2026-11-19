import { ok, err, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type {
  ConnectionStatus,
  FetchedTemplate,
  TemplateCategoryValue,
  TemplateStatus,
  WhatsAppConnectionRecord,
} from "../domain/repositories";
import type { MetaTemplateRecord } from "./ports";
import type { OutreachDeps } from "./outreach-deps";
import { conflict } from "./support";

const STATUS_ALLOWLIST: ReadonlySet<string> = new Set([
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "PENDING",
  "IN_APPEAL",
  "ARCHIVED",
  "PENDING_DELETION",
  "DELETED",
]);

/** Allowlisted statuses only. Anything else (REINSTATED, FLAGGED, LOCKED, ...) is non-sendable `UNKNOWN`. */
export function normalizeTemplateStatus(status: unknown): TemplateStatus {
  return typeof status === "string" && STATUS_ALLOWLIST.has(status.toUpperCase())
    ? (status.toUpperCase() as TemplateStatus)
    : "UNKNOWN";
}

export function normalizeTemplateCategory(category: unknown): TemplateCategoryValue | null {
  if (typeof category !== "string") return null;
  const c = category.toUpperCase();
  return c === "UTILITY" || c === "MARKETING" || c === "AUTHENTICATION" ? c : null;
}

/** The internal language code uses `_` (`en-US` and `en_US` are the same language). */
export function normalizeLanguage(language: string): string {
  return language.replace(/-/g, "_");
}

/**
 * A template as Meta reports it. An unrecognised category cannot be trusted: it is stored as MARKETING (the strictest
 * consent) with the non-sendable `UNKNOWN` status until the next sync.
 */
export function fetchedFromMeta(deps: OutreachDeps, m: MetaTemplateRecord): FetchedTemplate {
  const category = normalizeTemplateCategory(m.category);
  return {
    id: deps.idGenerator.generate(),
    metaTemplateId: m.id,
    name: m.name,
    language: normalizeLanguage(m.language),
    category: category ?? "MARKETING",
    status: category === null ? "UNKNOWN" : normalizeTemplateStatus(m.status),
    components: m.components,
    rejectedReason: m.rejectedReason,
    qualityScore: m.qualityScore,
  };
}

export interface ActiveConnection {
  row: WhatsAppConnectionRecord;
  token: string;
  /** Captured BEFORE the external call; compared in the final transaction (snapshot rule). */
  snapshot: {
    version: number;
    phoneNumberId: string;
    wabaId: string;
    status: ConnectionStatus;
  };
}

/**
 * The tenant's connected WhatsApp account and its token. `WHATSAPP_NOT_CONFIGURED` when the platform ports are absent,
 * `WHATSAPP_NOT_CONNECTED` unless the status is exactly `connected` (or `error`, when `allowError` is set).
 */
export async function loadActiveConnection(
  deps: OutreachDeps,
  tenantId: string,
  opts: { allowError?: boolean } = {},
): Promise<Result<ActiveConnection, DomainError>> {
  if (deps.whatsapp === undefined || deps.vault === undefined) {
    return err(conflict("WHATSAPP_NOT_CONFIGURED"));
  }
  const row = await deps.connections.get(tenantId);
  if (
    row === null ||
    (row.status !== "connected" && !(opts.allowError === true && row.status === "error")) ||
    row.sealedCredentials === ""
  ) {
    return err(conflict("WHATSAPP_NOT_CONNECTED"));
  }
  const token = await openToken(deps, tenantId, row.sealedCredentials);
  if (token === null) return err(conflict("CREDENTIALS_UNAVAILABLE"));
  return ok({
    row,
    token,
    snapshot: {
      version: row.version,
      phoneNumberId: row.phoneNumberId,
      wabaId: row.wabaId,
      status: row.status,
    },
  });
}

export async function openToken(
  deps: OutreachDeps,
  tenantId: string,
  sealed: string,
): Promise<string | null> {
  const secrets = await openSecrets(deps, tenantId, sealed);
  return secrets === null ? null : secrets.accessToken;
}

export async function openSecrets(
  deps: OutreachDeps,
  tenantId: string,
  sealed: string,
): Promise<{ accessToken: string; pin: string } | null> {
  if (deps.vault === undefined) return null;
  try {
    const s = await deps.vault.open(tenantId, "whatsapp", sealed);
    return typeof s.accessToken === "string" && s.accessToken !== ""
      ? { accessToken: s.accessToken, pin: typeof s.pin === "string" ? s.pin : "" }
      : null;
  } catch {
    return null;
  }
}

/** Does the stored connection still equal the snapshot taken before the external call? */
export async function connectionUnchanged(
  deps: OutreachDeps,
  tenantId: string,
  snapshot: ActiveConnection["snapshot"],
  tx: unknown,
  opts: { allowError?: boolean } = {},
): Promise<boolean> {
  const row = await deps.connections.get(tenantId, tx);
  return (
    row !== null &&
    (row.status === "connected" || (opts.allowError === true && row.status === "error")) &&
    row.version === snapshot.version &&
    row.phoneNumberId === snapshot.phoneNumberId &&
    row.wabaId === snapshot.wabaId
  );
}
