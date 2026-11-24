"use client";

import { STAFF_ROLES, type StaffRole } from "@/lib/api/staff";
import type { Dictionary } from "@/messages/en";

/**
 * The three fixed roles as a radio group, each with its one-line description beside the name (a
 * plain `<select>` could not show what each role allows). Native radios: keyboard, RTL and screen
 * readers come for free.
 */
export function RoleChoice({
  name,
  value,
  onChange,
  disabled,
  t,
}: {
  readonly name: string;
  readonly value: StaffRole;
  readonly onChange: (role: StaffRole) => void;
  readonly disabled: boolean;
  readonly t: Dictionary;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">{t.users.invite.roleLabel}</legend>
      {STAFF_ROLES.map((role) => (
        <label
          key={role}
          className="border-border has-[:checked]:border-primary has-[:checked]:bg-primary-subtle grid cursor-pointer grid-cols-[auto_1fr] gap-x-3 rounded-xl border p-3"
        >
          <input
            type="radio"
            name={name}
            value={role}
            checked={value === role}
            onChange={() => onChange(role)}
            className="row-span-2 mt-1"
          />
          <span className="text-sm font-medium">{t.users.roles[role]}</span>
          <span className="text-muted-foreground text-sm">{t.users.roleDescriptions[role]}</span>
        </label>
      ))}
    </fieldset>
  );
}
