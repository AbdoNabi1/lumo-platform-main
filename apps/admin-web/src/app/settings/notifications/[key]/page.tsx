import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { TemplateEditor } from "@/components/settings/notifications/template-editor";
import { SettingsFrame } from "@/components/settings/settings-frame";
import { fetchNotificationTemplates } from "@/lib/api/notification-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { isTemplateKey } from "@/lib/notification-settings-model";

/**
 * Wave 2b - Settings → Notifications → one template. The key comes from the URL, so anything that
 * is not one of the six known templates is a 404 before the API is asked.
 */
export default async function NotificationTemplatePage({
  params,
}: {
  readonly params: Promise<{ readonly key: string }>;
}) {
  const { key } = await params;
  if (!isTemplateKey(key)) notFound();

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const copy = t.notificationSettings;
  const user = await getCurrentUser();
  const result = await fetchNotificationTemplates();
  const template =
    result.outcome === "ok" ? result.templates.find((item) => item.key === key) : undefined;

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <SettingsFrame t={t} activeId="notifications">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header>
            <Link
              href="/settings/notifications"
              className="text-muted-foreground text-sm hover:underline"
            >
              {copy.editor.back}
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {copy.templateNames[key]}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">{copy.editor.subtitle}</p>
          </header>

          {template !== undefined ? (
            <TemplateEditor template={template} initialLocale={locale} t={t} />
          ) : (
            <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
              {result.outcome === "unauthorized" ? (
                <LockIcon aria-hidden="true" className="size-4" />
              ) : (
                <AlertTriangleIcon aria-hidden="true" className="size-4" />
              )}
              {result.outcome === "unauthorized" ? copy.unauthorized : copy.editor.loadError}
            </div>
          )}
        </div>
      </SettingsFrame>
    </AppShell>
  );
}
