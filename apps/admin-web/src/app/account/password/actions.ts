"use server";

import { mutateAdminApi } from "@/lib/api/client";

/** Plan 1C: what the change-password form renders after a submit. Messages are bilingual in the form. */
export type ChangePasswordState =
  | { readonly status: "idle" }
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly reason: "mismatch" | "wrong" | "weak" | "unavailable" };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

/**
 * `POST /auth/staff/password` (`account:update_self`, not idempotent: replaying a change must fail on
 * the now-stale current password, never return a cached success). The passwords stay inside this
 * server action and the request body; nothing is logged or put in a URL.
 */
export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const currentPassword = field(formData, "currentPassword");
  const newPassword = field(formData, "newPassword");
  const confirm = field(formData, "confirm");
  if (newPassword !== confirm) return { status: "error", reason: "mismatch" };
  const result = await mutateAdminApi(
    "/api/v1/auth/staff/password",
    { method: "POST", body: { currentPassword, newPassword } },
    isUnknown,
  );
  switch (result.outcome) {
    case "ok":
      return { status: "ok" };
    case "unauthorized":
      return { status: "error", reason: "wrong" };
    case "invalid":
      return { status: "error", reason: "weak" };
    default:
      return { status: "error", reason: "unavailable" };
  }
}
