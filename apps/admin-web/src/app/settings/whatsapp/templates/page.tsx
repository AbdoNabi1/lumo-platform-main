import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { BrandText } from "@/components/settings/whatsapp/brand-text";
import { TemplatesTable } from "@/components/settings/whatsapp/templates-table";
import { fetchWhatsAppConnection, fetchWhatsAppTemplateRows } from "@/lib/api/outreach";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Outreach Part 1 — Settings → WhatsApp → Templates: the active account's message templates with Sync from Meta, New
 * template and a confirmed delete. Templates belong to the connected WhatsApp Business account, so nothing is listed
 * (and nothing can be created) until WhatsApp is connected.
 */
export default async function WhatsAppTemplatesPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const copy = t.whatsappTemplates;
  const user = await getCurrentUser();
  const connection = await fetchWhatsAppConnection();
  const active =
    connection.outcome === "ok" &&
    connection.data.available &&
    (connection.data.status === "connected" || connection.data.status === "error");
  const rows = active ? await fetchWhatsAppTemplateRows() : null;

  const failure =
    connection.outcome === "ok"
      ? rows !== null && rows.outcome !== "ok"
        ? rows
        : null
      : connection;

  let content: ReactNode;
  if (failure !== null) {
    content = (
      <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
        {failure.outcome === "unauthorized" ? (
          <LockIcon aria-hidden="true" className="size-4" />
        ) : (
          <AlertTriangleIcon aria-hidden="true" className="size-4" />
        )}
        <BrandText text={failure.outcome === "unauthorized" ? copy.unauthorized : copy.loadError} />
      </div>
    );
  } else if (!active || rows === null || rows.outcome !== "ok") {
    content = (
      <Card>
        <CardHeader>
          <CardTitle as="h2">
            <BrandText text={copy.notConnectedTitle} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            <BrandText text={copy.notConnectedBody} />
          </p>
          <div>
            <Button asChild variant="outline">
              <Link href="/settings/whatsapp">
                <BrandText text={copy.goToConnection} />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  } else {
    content = <TemplatesTable rows={rows.data} t={t} />;
  }

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div dir={directionFor(locale)} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <Link href="/settings/whatsapp" className="text-muted-foreground text-sm hover:underline">
            <BrandText text={copy.back} />
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            <BrandText text={copy.subtitle} />
          </p>
        </header>
        {content}
      </div>
    </AppShell>
  );
}
