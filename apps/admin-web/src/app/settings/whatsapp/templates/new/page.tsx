import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { BrandText } from "@/components/settings/whatsapp/brand-text";
import { TemplateForm } from "@/components/settings/whatsapp/template-form";
import { fetchWhatsAppConnection } from "@/lib/api/outreach";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Outreach Part 1 — Settings → WhatsApp → Templates → New: write a template and submit it to Meta for review. */
export default async function NewWhatsAppTemplatePage() {
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

  let content: ReactNode;
  if (connection.outcome !== "ok") {
    content = (
      <div role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
        {connection.outcome === "unauthorized" ? (
          <LockIcon aria-hidden="true" className="size-4" />
        ) : (
          <AlertTriangleIcon aria-hidden="true" className="size-4" />
        )}
        <BrandText
          text={connection.outcome === "unauthorized" ? copy.unauthorized : copy.loadError}
        />
      </div>
    );
  } else if (!active) {
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
    content = <TemplateForm t={t} locale={locale} />;
  }

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div dir={directionFor(locale)} className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header>
          <Link
            href="/settings/whatsapp/templates"
            className="text-muted-foreground text-sm hover:underline"
          >
            {copy.form.back}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.form.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            <BrandText text={copy.form.description} />
          </p>
        </header>
        {content}
      </div>
    </AppShell>
  );
}
