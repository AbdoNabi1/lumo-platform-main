"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import {
  emergencyRevokeCredentialsAction,
  rotateDueCredentialsAction,
  scheduleCredentialRotationAction,
} from "@/app/security/secrets/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

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
 * "Schedule rotation" (T5.12c) — standalone form with a manual `credentialId` field.
 * `SecretExplorerDto`'s rows (`lib/api/security.ts`'s `SecretRowDto`) expose only
 * `principalRef`/`kind`/`status`/`rotationDueAt`/`autoRotate` — no credential id — so there is
 * nothing on this page to attach a per-row form to; verified fresh for this part rather than
 * assumed, same discipline `SuspendMachineIdentityForm`/`SuspendAiIdentityForm` already document
 * for their own explorers in T5.12a/b.
 */
export function ScheduleCredentialRotationForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    scheduleCredentialRotationAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySecretsPage.scheduleRotation.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySecretsPage.scheduleRotation.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-credentialId`}
          name="credentialId"
          label={t.securitySecretsPage.scheduleRotation.credentialId}
          error={fieldErrors["credentialId"]}
        />
        <Field
          id={`${formId}-intervalDays`}
          name="intervalDays"
          label={t.securitySecretsPage.scheduleRotation.intervalDays}
          error={fieldErrors["intervalDays"]}
          type="number"
          min={1}
        />
        <Field
          id={`${formId}-graceSeconds`}
          name="graceSeconds"
          label={t.securitySecretsPage.scheduleRotation.graceSeconds}
          error={fieldErrors["graceSeconds"]}
          type="number"
          min={0}
        />
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input type="checkbox" name="autoRotate" defaultChecked />
          {t.securitySecretsPage.scheduleRotation.autoRotate}
        </label>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySecretsPage.scheduleRotation.submitting
            : t.securitySecretsPage.scheduleRotation.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Rotate due credentials" (T5.12c) — the scheduler-driven bulk rotation, forced to run now. No
 * fields: the route takes neither an id nor a body. Confirmed before submit (constraint #10) — a
 * bulk action that, unlike this screen's other writes, is **not** `idempotent` on the backend (route
 * table).
 */
export function RotateDueCredentialsButton({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(rotateDueCredentialsAction, INITIAL_STATE);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securitySecretsPage.rotateDue.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-muted-foreground text-sm">{t.securitySecretsPage.rotateDue.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySecretsPage.rotateDue.success}
        </p>
      )}

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securitySecretsPage.rotateDue.submitting : t.securitySecretsPage.rotateDue.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Emergency revoke" (T5.12c) — the plan's named "credential rotation" high-blast-radius category's
 * single highest-blast-radius action: revokes every non-terminal credential a principal holds, in
 * one irreversible call (breach response — `EmergencyRevokeCredentials.execute`'s own doc comment).
 * Confirmed with an explicit dialog naming the exact `principalExternalId` typed into the form and
 * stating the full blast radius — not the generic "are you sure?" text every other destructive
 * control on this screen/task uses, per the task brief's explicit call-out for this one action.
 */
export function EmergencyRevokeCredentialsForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    emergencyRevokeCredentialsAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const formData = new FormData(event.currentTarget);
        const rawPrincipal = formData.get("principalExternalId");
        const principal = typeof rawPrincipal === "string" ? rawPrincipal.trim() : "";
        if (principal.length === 0) return;
        const message = t.securitySecretsPage.emergencyRevoke.confirm.replace("{principal}", principal);
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securitySecretsPage.emergencyRevoke.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySecretsPage.emergencyRevoke.success}
        </p>
      )}

      <Field
        id={`${formId}-principalExternalId`}
        name="principalExternalId"
        label={t.securitySecretsPage.emergencyRevoke.principalExternalId}
        error={fieldErrors["principalExternalId"]}
      />
      <Field
        id={`${formId}-reason`}
        name="reason"
        label={t.securitySecretsPage.emergencyRevoke.reason}
        error={fieldErrors["reason"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySecretsPage.emergencyRevoke.submitting
            : t.securitySecretsPage.emergencyRevoke.submit}
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
  type,
  min,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly type?: string;
  readonly min?: number;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        min={min}
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
