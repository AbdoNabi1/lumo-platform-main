"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Badge, Button, Input, Label } from "@platform/ui";
import {
  addIncidentEvidenceAction,
  checkThreatIndicatorAction,
  closeIncidentAction,
  evaluateComplianceAction,
  mitigateIncidentAction,
  openIncidentAction,
  registerComplianceRuleAction,
  resolveIncidentAction,
  triageIncidentAction,
  type CheckThreatIndicatorFormState,
  type EvaluateComplianceFormState,
} from "@/app/security/audit/actions";
import { INCIDENT_NEXT_ACTIONS, type IncidentLifecycleAction } from "@/lib/api/security";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };
const CHECK_INITIAL_STATE: CheckThreatIndicatorFormState = { status: "idle" };
const EVALUATE_INITIAL_STATE: EvaluateComplianceFormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

function ErrorBanner({ message }: { readonly message: string }) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
    >
      <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/**
 * "Open incident" (T5.12d) — a standalone create form. `severity`'s 4 values render as a `<select>`
 * per the task brief (a fixed enum, not free text). `reference`/`tenantRef` are optional — a blank
 * `reference` lets the backend mint one (`INC-...`).
 */
export function OpenIncidentForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(openIncidentAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAuditPage.openIncident.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAuditPage.openIncident.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-title`}
          name="title"
          label={t.securityAuditPage.openIncident.titleLabel}
          error={fieldErrors["title"]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-severity`}>{t.securityAuditPage.openIncident.severity}</Label>
          <select id={`${formId}-severity`} name="severity" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securityAuditPage.openIncident.severityUnspecified}
            </option>
            <option value="low">{t.securityAuditPage.severities.low}</option>
            <option value="medium">{t.securityAuditPage.severities.medium}</option>
            <option value="high">{t.securityAuditPage.severities.high}</option>
            <option value="critical">{t.securityAuditPage.severities.critical}</option>
          </select>
          {fieldErrors["severity"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["severity"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-category`}
          name="category"
          label={t.securityAuditPage.openIncident.category}
          error={fieldErrors["category"]}
        />
        <Field
          id={`${formId}-reference`}
          name="reference"
          label={t.securityAuditPage.openIncident.reference}
        />
        <Field
          id={`${formId}-tenantRef`}
          name="tenantRef"
          label={t.securityAuditPage.openIncident.tenantRef}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.openIncident.submitting
            : t.securityAuditPage.openIncident.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * Per-row incident lifecycle controls (T5.12d) — `IncidentRowDto` exposes both `reference` and
 * `status` per row (unlike `AiGovernanceRowDto`/`MachineIdentityRowDto` in T5.12a/b), so this
 * attaches directly to each incident-explorer row. Only the actions `INCIDENT_NEXT_ACTIONS` marks
 * legal from the row's current status are offered — a `closed` incident renders nothing (terminal).
 */
export function IncidentLifecycleControl({
  reference,
  status,
  t,
}: {
  readonly reference: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const nextActions: readonly IncidentLifecycleAction[] = INCIDENT_NEXT_ACTIONS[status] ?? [];

  if (nextActions.length === 0) {
    return <span className="text-muted-foreground text-xs">{t.securityAuditPage.incidentActions.terminal}</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      {nextActions.includes("triage") && <TriageIncidentRowForm reference={reference} t={t} />}
      {nextActions.includes("mitigate") && <MitigateIncidentRowForm reference={reference} t={t} />}
      {nextActions.includes("resolve") && <ResolveIncidentRowForm reference={reference} t={t} />}
      {nextActions.includes("close") && <CloseIncidentRowForm reference={reference} t={t} />}
    </div>
  );
}

function TriageIncidentRowForm({ reference, t }: { readonly reference: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(triageIncidentAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="reference" value={reference} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${formId}-assignee`} className="sr-only">
          {t.securityAuditPage.incidentActions.triage.assignee}
        </Label>
        <Input
          id={`${formId}-assignee`}
          name="assignee"
          placeholder={t.securityAuditPage.incidentActions.triage.assignee}
          className="h-8 w-28 text-xs"
        />
        <Label htmlFor={`${formId}-note`} className="sr-only">
          {t.securityAuditPage.incidentActions.triage.note}
        </Label>
        <Input
          id={`${formId}-note`}
          name="note"
          placeholder={t.securityAuditPage.incidentActions.triage.note}
          className="h-8 w-28 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.incidentActions.triage.submitting
            : t.securityAuditPage.incidentActions.triage.submit}
        </Button>
      </div>
      {state.status === "error" &&
        fieldErrors["reference"] === undefined &&
        fieldErrors["assignee"] === undefined &&
        fieldErrors["note"] === undefined && (
          <p role="alert" className="text-destructive text-xs">
            {state.message}
          </p>
        )}
    </form>
  );
}

function MitigateIncidentRowForm({ reference, t }: { readonly reference: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(mitigateIncidentAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="reference" value={reference} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${formId}-note`} className="sr-only">
          {t.securityAuditPage.incidentActions.mitigate.note}
        </Label>
        <Input
          id={`${formId}-note`}
          name="note"
          placeholder={t.securityAuditPage.incidentActions.mitigate.note}
          className="h-8 w-28 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.incidentActions.mitigate.submitting
            : t.securityAuditPage.incidentActions.mitigate.submit}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

function ResolveIncidentRowForm({ reference, t }: { readonly reference: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(resolveIncidentAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="reference" value={reference} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${formId}-resolution`} className="sr-only">
          {t.securityAuditPage.incidentActions.resolve.resolution}
        </Label>
        <Input
          id={`${formId}-resolution`}
          name="resolution"
          placeholder={t.securityAuditPage.incidentActions.resolve.resolution}
          className="h-8 w-28 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.incidentActions.resolve.submitting
            : t.securityAuditPage.incidentActions.resolve.submit}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * The terminal action: `Incident.TRANSITIONS`'s `closed: []` — no route reopens a closed incident,
 * so this is confirmed before submit (constraint #10) even though `close` is `idempotent: true` on
 * the backend.
 */
function CloseIncidentRowForm({ reference, t }: { readonly reference: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(closeIncidentAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityAuditPage.incidentActions.close.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="reference" value={reference} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${formId}-note`} className="sr-only">
          {t.securityAuditPage.incidentActions.close.note}
        </Label>
        <Input
          id={`${formId}-note`}
          name="note"
          placeholder={t.securityAuditPage.incidentActions.close.note}
          className="h-8 w-28 text-xs"
        />
        <Button type="submit" size="sm" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.incidentActions.close.submitting
            : t.securityAuditPage.incidentActions.close.submit}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * "Add evidence" (T5.12d) — a standalone form per the task brief's own listing (not folded into the
 * per-row lifecycle controls above). `reference` is a manual field even though `IncidentRowDto`
 * exposes one per row, since the brief calls this out as its own form.
 */
export function AddIncidentEvidenceForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(addIncidentEvidenceAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAuditPage.addEvidence.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAuditPage.addEvidence.success}
        </p>
      )}

      <Field
        id={`${formId}-reference`}
        name="reference"
        label={t.securityAuditPage.addEvidence.reference}
        error={fieldErrors["reference"]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-kind`}
          name="kind"
          label={t.securityAuditPage.addEvidence.kind}
          error={fieldErrors["kind"]}
        />
        <Field
          id={`${formId}-ref`}
          name="ref"
          label={t.securityAuditPage.addEvidence.ref}
          error={fieldErrors["ref"]}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAuditPage.addEvidence.submitting : t.securityAuditPage.addEvidence.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Check threat indicator" (T5.12d) — a simulation/lookup panel, not a mutation with lasting effect
 * worth navigating away for (see `checkThreatIndicatorAction`'s doc comment, matching T5.12a's
 * `CheckAiActionPanel`). Renders the raw `ThreatVerdictDto` back inline; never `revalidatePath`s.
 */
export function CheckThreatIndicatorPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(checkThreatIndicatorAction, CHECK_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAuditPage.checkThreatIndicator.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <Field
        id={`${formId}-indicator`}
        name="indicator"
        label={t.securityAuditPage.checkThreatIndicator.indicator}
      />

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.checkThreatIndicator.submitting
            : t.securityAuditPage.checkThreatIndicator.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <Badge variant={state.verdict.malicious ? "destructive" : "success"} className="w-fit">
            {state.verdict.malicious
              ? t.securityAuditPage.checkThreatIndicator.resultMalicious
              : t.securityAuditPage.checkThreatIndicator.resultClean}
          </Badge>
          <p className="text-muted-foreground">
            {t.securityAuditPage.checkThreatIndicator.score}: {state.verdict.score}
          </p>
          <p className="text-muted-foreground">
            {t.securityAuditPage.checkThreatIndicator.categories}:{" "}
            {state.verdict.categories.length > 0 ? state.verdict.categories.join(", ") : t.securityAuditPage.checkThreatIndicator.none}
          </p>
          <p className="text-muted-foreground">
            {t.securityAuditPage.checkThreatIndicator.source}: {state.verdict.source}
          </p>
          <p className="text-muted-foreground">
            {t.securityAuditPage.checkThreatIndicator.providers}: {state.verdict.providers.join(", ")}
          </p>
        </div>
      )}
    </form>
  );
}

/**
 * "Evaluate compliance" (T5.12d) — also a simulation/evaluation panel, not a mutation (see
 * `evaluateComplianceAction`'s doc comment). `framework` renders as a `<select>` per the task
 * brief's fixed enum; `attestations` are 3 checkboxes for the signals not derivable from platform
 * state.
 */
export function EvaluateCompliancePanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(evaluateComplianceAction, EVALUATE_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAuditPage.evaluateCompliance.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-framework`}>{t.securityAuditPage.evaluateCompliance.framework}</Label>
          <select id={`${formId}-framework`} name="framework" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securityAuditPage.evaluateCompliance.frameworkUnspecified}
            </option>
            <option value="gdpr">{t.securityAuditPage.frameworks.gdpr}</option>
            <option value="soc2">{t.securityAuditPage.frameworks.soc2}</option>
            <option value="iso27001">{t.securityAuditPage.frameworks.iso27001}</option>
            <option value="hipaa">{t.securityAuditPage.frameworks.hipaa}</option>
            <option value="pci_dss">{t.securityAuditPage.frameworks.pci_dss}</option>
          </select>
        </div>
        <Field
          id={`${formId}-tenantRef`}
          name="tenantRef"
          label={t.securityAuditPage.evaluateCompliance.tenantRef}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="encryptionAtRest" />
          {t.securityAuditPage.evaluateCompliance.encryptionAtRest}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="consentTracked" />
          {t.securityAuditPage.evaluateCompliance.consentTracked}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="retentionDefined" />
          {t.securityAuditPage.evaluateCompliance.retentionDefined}
        </label>
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.evaluateCompliance.submitting
            : t.securityAuditPage.evaluateCompliance.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <Badge variant={state.report.compliant ? "success" : "destructive"} className="w-fit">
            {state.report.compliant
              ? t.securityAuditPage.evaluateCompliance.resultCompliant
              : t.securityAuditPage.evaluateCompliance.resultNonCompliant}
          </Badge>
          <div className="flex gap-4 text-muted-foreground">
            <span>
              {t.securityAuditPage.evaluateCompliance.passed}: {state.report.passed}
            </span>
            <span>
              {t.securityAuditPage.evaluateCompliance.failed}: {state.report.failed}
            </span>
            <span>
              {t.securityAuditPage.evaluateCompliance.notApplicable}: {state.report.notApplicable}
            </span>
          </div>
          {state.report.findings.length > 0 && (
            <ul className="flex flex-col gap-1">
              {state.report.findings.map((finding) => (
                <li key={finding.controlId} className="text-muted-foreground">
                  {finding.controlId} — <Badge variant="neutral">{finding.status}</Badge> — {finding.severity} —{" "}
                  {finding.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * "Register compliance rule" (T5.12d) — a standalone create form. `framework`/`severity` render as
 * `<select>`s per the task brief's fixed enums.
 */
export function RegisterComplianceRuleForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerComplianceRuleAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAuditPage.registerComplianceRule.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAuditPage.registerComplianceRule.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-id`}
          name="id"
          label={t.securityAuditPage.registerComplianceRule.id}
          error={fieldErrors["id"]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-framework`}>{t.securityAuditPage.registerComplianceRule.framework}</Label>
          <select id={`${formId}-framework`} name="framework" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securityAuditPage.registerComplianceRule.frameworkUnspecified}
            </option>
            <option value="gdpr">{t.securityAuditPage.frameworks.gdpr}</option>
            <option value="soc2">{t.securityAuditPage.frameworks.soc2}</option>
            <option value="iso27001">{t.securityAuditPage.frameworks.iso27001}</option>
            <option value="hipaa">{t.securityAuditPage.frameworks.hipaa}</option>
            <option value="pci_dss">{t.securityAuditPage.frameworks.pci_dss}</option>
          </select>
          {fieldErrors["framework"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["framework"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-description`}
          name="description"
          label={t.securityAuditPage.registerComplianceRule.description}
          error={fieldErrors["description"]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-severity`}>{t.securityAuditPage.registerComplianceRule.severity}</Label>
          <select id={`${formId}-severity`} name="severity" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securityAuditPage.registerComplianceRule.severityUnspecified}
            </option>
            <option value="low">{t.securityAuditPage.severities.low}</option>
            <option value="medium">{t.securityAuditPage.severities.medium}</option>
            <option value="high">{t.securityAuditPage.severities.high}</option>
            <option value="critical">{t.securityAuditPage.severities.critical}</option>
          </select>
          {fieldErrors["severity"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["severity"]}</p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAuditPage.registerComplianceRule.submitting
            : t.securityAuditPage.registerComplianceRule.submit}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  error,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
