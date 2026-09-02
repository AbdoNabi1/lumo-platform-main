"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  addIncidentEvidence,
  checkThreatIndicator,
  closeIncident,
  evaluateCompliance,
  mitigateIncident,
  openIncident,
  registerComplianceRule,
  resolveIncident,
  triageIncident,
  type ComplianceControlSeverity,
  type ComplianceFramework,
  type ComplianceReportDto,
  type IncidentSeverity,
  type ThreatVerdictDto,
} from "@/lib/api/security";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.12d — Operations' incident-lifecycle, threat-indicator, and compliance write actions,
 * following the same `apps/admin-web/README.md` write-screen recipe T5.12a/b/c's actions already
 * use: parse `FormData` defensively, mint one `Idempotency-Key` per invocation (constraint #8),
 * call the typed `lib/api/security.ts` function, `revalidatePath("/security/audit")` on `ok`
 * (except `checkThreatIndicatorAction`/`evaluateComplianceAction` — see their own doc comments,
 * matching T5.12a's `checkAiActionAction`), otherwise project through `toFormState`.
 */

const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = ["low", "medium", "high", "critical"];

function isIncidentSeverity(value: string): value is IncidentSeverity {
  return (INCIDENT_SEVERITIES as readonly string[]).includes(value);
}

const COMPLIANCE_FRAMEWORKS: readonly ComplianceFramework[] = [
  "gdpr",
  "soc2",
  "iso27001",
  "hipaa",
  "pci_dss",
];

function isComplianceFramework(value: string): value is ComplianceFramework {
  return (COMPLIANCE_FRAMEWORKS as readonly string[]).includes(value);
}

const COMPLIANCE_SEVERITIES: readonly ComplianceControlSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

function isComplianceSeverity(value: string): value is ComplianceControlSeverity {
  return (COMPLIANCE_SEVERITIES as readonly string[]).includes(value);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Opens a new incident. `reference` is optional — server-generated (`INC-...`) when omitted. */
export async function openIncidentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const title = stringField(formData, "title").trim();
  const severityRaw = stringField(formData, "severity").trim();
  const category = stringField(formData, "category").trim();
  const reference = optionalStringField(formData, "reference");
  const tenantRef = optionalStringField(formData, "tenantRef");

  const fieldErrors: Record<string, string> = {};
  if (title.length === 0) fieldErrors["title"] = t.invalid;
  if (!isIncidentSeverity(severityRaw)) fieldErrors["severity"] = t.invalid;
  if (category.length === 0) fieldErrors["category"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await openIncident(
    { title, severity: severityRaw as IncidentSeverity, category, reference, tenantRef },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/audit");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Triages an incident (assigns an owner) — a per-row control on the incident explorer, offered only
 * when `INCIDENT_NEXT_ACTIONS` marks it legal from the row's current status. `reference` is
 * re-derived from the submitted `FormData` (a per-row hidden field), not a trusted closure variable,
 * same discipline `transitionPrincipalAction` (T5.12b) documents.
 */
export async function triageIncidentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reference = stringField(formData, "reference").trim();
  const assignee = stringField(formData, "assignee").trim();
  const note = stringField(formData, "note").trim();

  const fieldErrors: Record<string, string> = {};
  if (reference.length === 0) fieldErrors["reference"] = t.invalid;
  if (assignee.length === 0) fieldErrors["assignee"] = t.invalid;
  if (note.length === 0) fieldErrors["note"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await triageIncident(reference, assignee, note, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/audit");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Marks an incident as being mitigated — a per-row control, same gating as `triageIncidentAction`. */
export async function mitigateIncidentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reference = stringField(formData, "reference").trim();
  const note = stringField(formData, "note").trim();

  const fieldErrors: Record<string, string> = {};
  if (reference.length === 0) fieldErrors["reference"] = t.invalid;
  if (note.length === 0) fieldErrors["note"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await mitigateIncident(reference, note, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/audit");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Resolves an incident — a per-row control, same gating as `triageIncidentAction`. */
export async function resolveIncidentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reference = stringField(formData, "reference").trim();
  const resolution = stringField(formData, "resolution").trim();

  const fieldErrors: Record<string, string> = {};
  if (reference.length === 0) fieldErrors["reference"] = t.invalid;
  if (resolution.length === 0) fieldErrors["resolution"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await resolveIncident(reference, resolution, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/audit");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Closes an incident (post-mortem complete) — a per-row control, same gating as
 * `triageIncidentAction`. A terminal, hard-to-undo transition (no route reopens a closed incident),
 * confirmed client-side before submit (constraint #10).
 */
export async function closeIncidentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reference = stringField(formData, "reference").trim();
  const note = stringField(formData, "note").trim();

  const fieldErrors: Record<string, string> = {};
  if (reference.length === 0) fieldErrors["reference"] = t.invalid;
  if (note.length === 0) fieldErrors["note"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await closeIncident(reference, note, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/audit");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Attaches an evidence reference to an incident — a standalone form (not folded into the per-row
 * lifecycle controls, per the task brief's own listing). **Not** `idempotent` on the backend — each
 * call appends another entry, so a resubmit is not a no-op.
 */
export async function addIncidentEvidenceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reference = stringField(formData, "reference").trim();
  const kind = stringField(formData, "kind").trim();
  const ref = stringField(formData, "ref").trim();

  const fieldErrors: Record<string, string> = {};
  if (reference.length === 0) fieldErrors["reference"] = t.invalid;
  if (kind.length === 0) fieldErrors["kind"] = t.invalid;
  if (ref.length === 0) fieldErrors["ref"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await addIncidentEvidence(reference, kind, ref, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/audit");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the "Check threat indicator" panel renders — a preview result, never routed through `toFormState`. */
export type CheckThreatIndicatorFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly verdict: ThreatVerdictDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Checks an indicator across every registered threat-intel provider — a "try it" simulation/lookup
 * tool per the task brief, not a mutation whose lasting effect a form should treat like a create
 * (matches T5.12a's `checkAiActionAction`). Never `revalidatePath`s anything, though the backend
 * still records telemetry/audit when the verdict is malicious.
 */
export async function checkThreatIndicatorAction(
  _previous: CheckThreatIndicatorFormState,
  formData: FormData,
): Promise<CheckThreatIndicatorFormState> {
  const t = await formErrorDictionary();

  const indicator = stringField(formData, "indicator").trim();
  if (indicator.length === 0) {
    return { status: "error", message: t.invalid };
  }

  const result = await checkThreatIndicator(indicator, newIdempotencyKey());
  if (result.outcome === "ok") return { status: "success", verdict: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

/** What the "Evaluate compliance" panel renders — a preview result, never routed through `toFormState`. */
export type EvaluateComplianceFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly report: ComplianceReportDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Evaluates a tenant's posture against a compliance framework's rule pack — also a "try it"
 * evaluation/read tool per the task brief, not a mutation. Never `revalidatePath`s anything, though
 * the backend still emits `security.compliance.evaluated` and a WORM audit record.
 */
export async function evaluateComplianceAction(
  _previous: EvaluateComplianceFormState,
  formData: FormData,
): Promise<EvaluateComplianceFormState> {
  const t = await formErrorDictionary();

  const frameworkRaw = stringField(formData, "framework").trim();
  if (!isComplianceFramework(frameworkRaw)) {
    return { status: "error", message: t.invalid };
  }
  const tenantRef = optionalStringField(formData, "tenantRef");
  const encryptionAtRest = formData.get("encryptionAtRest") === "on";
  const consentTracked = formData.get("consentTracked") === "on";
  const retentionDefined = formData.get("retentionDefined") === "on";

  const result = await evaluateCompliance(
    {
      framework: frameworkRaw,
      tenantRef,
      attestations: { encryptionAtRest, consentTracked, retentionDefined },
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") return { status: "success", report: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

/** Registers a compliance control into the versioned catalog. `idempotent: true` per `id`. */
export async function registerComplianceRuleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const id = stringField(formData, "id").trim();
  const frameworkRaw = stringField(formData, "framework").trim();
  const description = stringField(formData, "description").trim();
  const severityRaw = stringField(formData, "severity").trim();

  const fieldErrors: Record<string, string> = {};
  if (id.length === 0) fieldErrors["id"] = t.invalid;
  if (!isComplianceFramework(frameworkRaw)) fieldErrors["framework"] = t.invalid;
  if (description.length === 0) fieldErrors["description"] = t.invalid;
  if (!isComplianceSeverity(severityRaw)) fieldErrors["severity"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await registerComplianceRule(
    {
      id,
      framework: frameworkRaw as ComplianceFramework,
      description,
      severity: severityRaw as ComplianceControlSeverity,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/audit");
    return { status: "success" };
  }
  return toFormState(result, t);
}
