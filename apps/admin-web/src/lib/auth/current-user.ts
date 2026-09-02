import { redirect } from "next/navigation";
import type { CurrentUser } from "@/components/app-shell";
import { highestRole, readSession } from "@/lib/auth/session";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

/**
 * Phase A.34 (A.33 P1 #1) — replaces every page's hardcoded `CURRENT_USER = { name: "Abdullah
 * Nabil", role: "Owner" }`. `middleware.ts` already requires a valid session for every route that
 * renders `AppShell`, so `readSession()` returning `null` here means the token expired in the
 * narrow window between the middleware check and this render — re-send through the same
 * unauthenticated path middleware.ts uses, never a fake identity.
 *
 * `name` is the identity's email — Kratos's `identity.schema.json` has no separate display-name
 * trait, so email is the only real, non-invented value available to show.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const session = await readSession();
  if (session === null) {
    redirect("/login");
  }
  const role = highestRole(session.roles);
  const name = session.email ?? session.principalId;
  const initials = name.slice(0, 2).toUpperCase();
  return {
    name,
    role: role !== undefined ? (ROLE_LABEL[role] ?? role) : "Staff",
    initials,
  };
}
