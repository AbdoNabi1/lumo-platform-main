import { cookies } from "next/headers";
import { AlertTriangleIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PasswordProtectionCard } from "@/components/online-store/password-protection-card";
import { PreferencesForm } from "@/components/online-store/preferences-form";
import { fetchAccess, fetchPreferences } from "@/lib/api/online-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

function LoadError({ message }: { readonly message: string }) {
  return (
    <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
      <AlertTriangleIcon className="size-4" aria-hidden="true" />
      {message}
    </p>
  );
}

/**
 * Online Store → Preferences (spec 1.11). Viewer-readable (`ROUTE_ROLE_REQUIREMENTS`); edits need
 * an operator; the password lock needs an admin. The role only decides what is shown editable — the
 * API enforces every permission itself.
 */
export default async function OnlineStorePreferencesPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, preferences, access] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchPreferences(),
    fetchAccess(),
  ]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";
  const storefrontUrl = process.env["STOREFRONT_URL"]?.trim() || null;
  return (
    <AppShell t={t} locale={locale} activeNavId="online-store-preferences" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.onlineStorePreferences.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.onlineStorePreferences.subtitle}</p>
        </header>
        {preferences.outcome === "ok" ? (
          <PreferencesForm
            t={t}
            locale={locale}
            preferences={preferences.data}
            canEdit={canEdit}
            storefrontUrl={storefrontUrl}
          />
        ) : (
          <LoadError
            message={
              preferences.outcome === "unauthorized"
                ? t.formErrors.forbidden
                : t.formErrors.unexpected
            }
          />
        )}
        {access.outcome === "ok" ? (
          <PasswordProtectionCard
            t={t}
            locale={locale}
            access={access.data}
            isAdmin={role === "admin"}
          />
        ) : preferences.outcome === "ok" ? (
          <LoadError message={t.formErrors.unexpected} />
        ) : null}
      </div>
    </AppShell>
  );
}
