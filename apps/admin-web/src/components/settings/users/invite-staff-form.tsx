"use client";

import { useState, type FormEvent } from "react";
import { Input, Label } from "@platform/ui";
import type { StaffRole } from "@/lib/api/staff";
import type { Dictionary } from "@/messages/en";
import { RoleChoice } from "./role-choice";
import { DialogError, StaffDialogFooter } from "./staff-dialog";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The invite form: an email and a role. Mounted only while its dialog is open, so it starts empty
 * every time. The email shape is checked here for a fast answer (the same rule the server applies);
 * the server's answer is still the authority and is shown under the field.
 */
export function InviteStaffForm({
  t,
  pending,
  error,
  fieldError,
  onCancel,
  onSubmit,
}: {
  readonly t: Dictionary;
  readonly pending: boolean;
  readonly error: string | null;
  readonly fieldError: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (input: { email: string; role: StaffRole }) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("operator");
  const [localError, setLocalError] = useState<string | null>(null);
  const emailError = localError ?? fieldError;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    const trimmed = email.trim();
    if (trimmed.length > 254 || !EMAIL_SHAPE.test(trimmed)) {
      setLocalError(t.users.errors.emailInvalid);
      return;
    }
    setLocalError(null);
    onSubmit({ email: trimmed, role });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-invite-email">{t.users.invite.emailLabel}</Label>
        <Input
          id="staff-invite-email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="off"
          value={email}
          disabled={pending}
          aria-invalid={emailError === null ? undefined : true}
          aria-describedby={emailError === null ? undefined : "staff-invite-email-error"}
          onChange={(event) => {
            setEmail(event.target.value);
            setLocalError(null);
          }}
        />
        {emailError !== null && (
          <p id="staff-invite-email-error" role="alert" className="text-destructive text-sm">
            {emailError}
          </p>
        )}
      </div>
      <RoleChoice
        name="staff-invite-role"
        value={role}
        onChange={setRole}
        disabled={pending}
        t={t}
      />
      {error !== null && error !== emailError && <DialogError message={error} />}
      <StaffDialogFooter
        cancelLabel={t.users.invite.cancel}
        submitLabel={t.users.invite.submit}
        pendingLabel={t.users.invite.sending}
        pending={pending}
        destructive={false}
        submitType="submit"
        onCancel={onCancel}
      />
    </form>
  );
}
