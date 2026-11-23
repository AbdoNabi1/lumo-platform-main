import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BrandText } from "@/components/settings/whatsapp/brand-text";
import { WhatsAppConnectionCard } from "@/components/settings/whatsapp/whatsapp-connection-card";
import { fetchWhatsAppConnection, fetchWhatsAppTemplates } from "@/lib/api/outreach";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Outreach Part 1 — Settings → WhatsApp: connect the shop's WhatsApp Business number (Embedded Signup), see the
 * connection's health and send a test message. The templates are read only when there is a connection to send from.
 */
export default async function WhatsAppSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const result = await fetchWhatsAppConnection();
  const canSend =
    result.outcome === "ok" &&
    result.data.available &&
    (result.data.status === "connected" || result.data.status === "error");
  const templates = canSend ? await fetchWhatsAppTemplates() : null;

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div dir={directionFor(locale)} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {t.whatsappSettings.back}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            <BrandText text={t.whatsappSettings.title} />
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            <BrandText text={t.whatsappSettings.subtitle} />
          </p>
          {result.outcome === "ok" && result.data.available && (
            <p className="mt-2 text-sm">
              <Link href="/settings/whatsapp/templates" className="text-primary hover:underline">
                {t.whatsappSettings.templatesLink}
              </Link>
            </p>
          )}
        </header>

        {result.outcome === "ok" ? (
          <WhatsAppConnectionCard
            connection={result.data}
            templates={templates !== null && templates.outcome === "ok" ? templates.data : null}
            t={t}
            locale={locale}
          />
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {result.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            {result.outcome === "unauthorized"
              ? t.whatsappSettings.unauthorized
              : t.whatsappSettings.loadError}
          </div>
        )}
      </div>
    </AppShell>
  );
}
