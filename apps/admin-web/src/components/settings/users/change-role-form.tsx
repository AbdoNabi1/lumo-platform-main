"use client";

import { useState, type FormEvent } from "react";
import type { StaffRole } from "@/lib/api/staff";
import type { Dictionary } from "@/messages/en";
import { RoleChoice } from "./role-choice";
import { DialogError, StaffDialogFooter } from "./staff-dialog";

/** The change-role form: the three roles, starting on the member's current one. */
export function ChangeRoleForm({
  t,
  current,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  readonly t: Dictionary;
  readonly current: StaffRole;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (role: StaffRole) => void;
}) {
  const [role, setRole] = useState<StaffRole>(current);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!pending) onSubmit(role);
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <RoleChoice name="staff-role" value={role} onChange={setRole} disabled={pending} t={t} />
      <DialogError message={error} />
      <StaffDialogFooter
        cancelLabel={t.users.changeRole.cancel}
        submitLabel={t.users.changeRole.save}
        pendingLabel={t.users.changeRole.saving}
        pending={pending}
        destructive={false}
        submitType="submit"
        onCancel={onCancel}
      />
    </form>
  );
}
