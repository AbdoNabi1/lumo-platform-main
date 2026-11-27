import type { StaffActivityItem } from "@/lib/staff/two-step";
import type { Dictionary } from "@/messages/en";

/**
 * Wave 1e — turns one activity row into a localized sentence template. Pure and free of server imports.
 * The placeholders `{actor}`, `{subject}`, `{from}` and `{to}` are filled by the renderer (emails in a
 * `<bdi>`); the template choice depends on which details the server sent, so a role change without
 * the old and new role still reads naturally.
 */
export function activityTemplate(item: StaffActivityItem, t: Dictionary): string {
  const s = t.usersActivity.sentences;
  switch (item.kind) {
    case "signed_in":
      return s.signed_in;
    case "sign_in_failed":
      return s.sign_in_failed;
    case "code_failed":
      return s.code_failed;
    case "invited":
      return item.detail.to === undefined ? s.invited : s.invited_as;
    case "invitation_accepted":
      return s.invitation_accepted;
    case "invitation_revoked":
      return s.invitation_revoked;
    case "role_changed":
      return item.detail.from !== undefined && item.detail.to !== undefined
        ? s.role_changed_from_to
        : s.role_changed;
    case "deactivated":
      return s.deactivated;
    case "reactivated":
      return s.reactivated;
    case "two_step_on":
      return s.two_step_on;
    case "two_step_off":
      return s.two_step_off;
    case "backup_codes_regenerated":
      return s.backup_codes_regenerated;
    case "two_step_policy_changed":
      return item.detail.enabled === true ? s.two_step_policy_on : s.two_step_policy_off;
    case "two_step_reset":
      return s.two_step_reset;
    default:
      return t.usersActivity.unknownEvent;
  }
}

/** A role key as the locale's role name; anything unknown is shown as the server sent it. */
export function roleName(role: string, t: Dictionary): string {
  const names = t.users.roles as Readonly<Record<string, string>>;
  return names[role] ?? role;
}
