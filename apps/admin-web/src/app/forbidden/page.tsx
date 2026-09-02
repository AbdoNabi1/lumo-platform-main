import { cookies } from "next/headers";
import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Phase A.34 (A.33 P0 #4) — where `middleware.ts` redirects an authenticated-but-under-privileged
 * request (e.g. a `viewer` hitting `/settings`). Exempt from the role check itself
 * (`ROLE_EXEMPT_PREFIXES`) so it can never redirect-loop into itself.
 */
export default async function ForbiddenPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="" user={user}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span
              className="bg-destructive-subtle text-destructive-subtle-foreground flex size-12 items-center justify-center rounded-2xl"
              aria-hidden="true"
            >
              <ShieldAlertIcon className="size-6" />
            </span>
            <h1 className="text-3xl font-semibold tracking-tight">{t.forbidden.title}</h1>
            <p className="text-muted-foreground text-md max-w-md">{t.forbidden.body}</p>
            <Button asChild>
              <Link href="/">{t.forbidden.backToDashboard}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
