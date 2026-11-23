import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { BrandText } from "@/components/settings/whatsapp/brand-text";
import { EmailSenderCard } from "@/components/settings/email/email-sender-card";
import { EmailTestForm } from "@/components/settings/email/email-test-form";
import { fetchEmailSettings } from "@/lib/api/outreach";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Outreach Part 1 — Settings → Email: the sender customers see, where replies go, whether email is available on this
 * platform, and a test email. Part 1 email is order/transactional only.
 */
export default async function EmailSettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const copy = t.emailSettings;
  const user = await getCurrentUser();
  const result = await fetchEmailSettings();
  // The test goes to the signed-in user's own address unless they type another one.
  const session = await readSession();
  const defaultTo = session?.email ?? "";

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div dir={directionFor(locale)} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
            {copy.back}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            <BrandText text={copy.subtitle} />
          </p>
        </header>

        {result.outcome === "ok" ? (
          <>
            <EmailSenderCard settings={result.data} t={t} />
            {result.data.available && (
              <Card>
                <CardHeader>
                  <CardTitle as="h2">{copy.test.title}</CardTitle>
                  <CardDescription>{copy.test.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <EmailTestForm defaultTo={defaultTo} t={t} />
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
            {result.outcome === "unauthorized" ? (
              <LockIcon aria-hidden="true" className="size-4" />
            ) : (
              <AlertTriangleIcon aria-hidden="true" className="size-4" />
            )}
            <BrandText
              text={result.outcome === "unauthorized" ? copy.unauthorized : copy.loadError}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
