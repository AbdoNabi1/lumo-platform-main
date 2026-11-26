import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NotificationSettingsPanel } from "@/components/settings/notifications/notification-settings-panel";
import { SettingsFrame } from "@/components/settings/settings-frame";
import {
  fetchNotificationSettings,
  fetchNotificationTemplates,
  fetchSenderDomain,
} from "@/lib/api/notification-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Wave 2b - Settings → Notifications. Reads the settings document (with its version and whether
 * email really delivers), the templates and the sending domain, and renders the Sender email,
 * Authenticate domain, Customer notifications and Staff notifications sections. The domain read
 * failing alone does not hide the rest: that card says it could not load.
 */
export default async function NotificationSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const copy = t.notificationSettings;
  const user = await getCurrentUser();
  const [settings, templates, domain] = await Promise.all([
    fetchNotificationSettings(),
    fetchNotificationTemplates(),
    fetchSenderDomain(),
  ]);

  const failed =
    settings.outcome !== "ok" ? settings : templates.outcome !== "ok" ? templates : null;

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <SettingsFrame t={t} activeId="notifications">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header>
            <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
              {copy.back}
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{copy.subtitle}</p>
          </header>

          {settings.outcome === "ok" && templates.outcome === "ok" ? (
            <NotificationSettingsPanel
              settings={settings.settings}
              templates={templates.templates}
              senderDomain={domain.outcome === "ok" ? domain.senderDomain : null}
              t={t}
            />
          ) : (
            <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
              {failed?.outcome === "unauthorized" ? (
                <LockIcon aria-hidden="true" className="size-4" />
              ) : (
                <AlertTriangleIcon aria-hidden="true" className="size-4" />
              )}
              {failed?.outcome === "unauthorized" ? copy.unauthorized : copy.loadError}
            </div>
          )}
        </div>
      </SettingsFrame>
    </AppShell>
  );
}
