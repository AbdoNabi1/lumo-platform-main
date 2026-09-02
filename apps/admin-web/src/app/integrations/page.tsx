import { cookies } from "next/headers";
import { BlocksIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * The Integrations screen (Phase A.30). Audited: `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` is a
 * contract-only spec ("Status: CONTRACT ... No application code") that explicitly states this is
 * a net-new operator surface requiring approval before any UI is built. No bounded context, no
 * repository, no admin route exists to read connection/config status from. Building a list here
 * would mean inventing every field — this screen states the real gap instead.
 *
 * Re-audited at T5.14 (Phase 5): `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` still reads
 * "Status: CONTRACT" (dated 2026-06-28, unchanged); no `services/integrations` (or equivalent)
 * directory exists anywhere in `services/*`. Gap unchanged.
 */
export default async function IntegrationsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="integrations" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">{t.integrationsPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.integrationsPage.subtitle}</p>
        </header>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <span
              className="bg-secondary text-secondary-foreground flex size-12 items-center justify-center rounded-2xl"
              aria-hidden="true"
            >
              <BlocksIcon className="size-6" />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t.integrationsPage.unavailableTitle}
            </h2>
            <p className="text-muted-foreground max-w-xl text-sm">
              {t.integrationsPage.unavailableBody}
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
