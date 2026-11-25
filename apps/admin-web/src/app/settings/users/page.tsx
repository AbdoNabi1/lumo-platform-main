import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { SettingsFrame } from "@/components/settings/settings-frame";
import { StaffPanel } from "@/components/settings/users/staff-panel";
import { fetchStaff, fetchStaffSecurityPolicy } from "@/lib/api/staff";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Settings → Users and permissions (Wave 1d): the store's staff, who may invite, change a role,
 * deactivate or reactivate, and resend or revoke an invitation. Admin-only by the middleware's
 * `/settings` rule, and the API enforces `staff:*` itself, so a 403 here is shown as such rather
 * than as an empty table. The signed-in member and the store owner get no actions.
 */
export default async function UsersPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, staff, policy] = await Promise.all([
    getCurrentUser(),
    fetchStaff(),
    fetchStaffSecurityPolicy(),
  ]);

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <SettingsFrame t={t} activeId="users">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          {staff.outcome === "ok" ? (
            <StaffPanel
              members={staff.data.items}
              policy={policy.outcome === "ok" ? policy.data : null}
              t={t}
              locale={locale}
              nowIso={new Date().toISOString()}
            />
          ) : (
            <>
              <header>
                <h1 className="text-2xl font-semibold tracking-tight">{t.users.title}</h1>
                <p className="text-muted-foreground mt-1 text-sm">{t.users.subtitle}</p>
              </header>
              <Card>
                <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-base">
                  {staff.outcome === "unauthorized" ? (
                    <LockIcon aria-hidden="true" className="size-5" />
                  ) : (
                    <AlertTriangleIcon aria-hidden="true" className="size-5" />
                  )}
                  <p role="alert">
                    {staff.outcome === "unauthorized"
                      ? staff.status === 403
                        ? t.users.forbidden
                        : t.users.unauthorized
                      : t.users.loadError}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </SettingsFrame>
    </AppShell>
  );
}
