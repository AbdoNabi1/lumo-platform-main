import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { TwoStepPanel } from "@/components/account/two-step-panel";
import { fetchOwnTwoStep } from "@/lib/api/two-step";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isNativeAuth } from "@/lib/auth/native";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The setup key is shown on this page, so it must never leave in a Referer header. */
export const metadata = { referrer: "no-referrer" };

/**
 * Wave 1e: the signed-in member's own two-step verification (authenticator app + backup codes).
 * Native sign-in only: under Ory the credential and its factors live in Kratos. `middleware.ts`
 * requires any signed-in role (viewer and up) and the API only ever answers for the caller themself.
 * This server component renders the STATUS only; the secret exists solely in the client panel's state.
 */
export default async function AccountSecurityPage() {
  if (!isNativeAuth()) redirect("/");
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, status] = await Promise.all([getCurrentUser(), fetchOwnTwoStep()]);

  return (
    <AppShell t={t} locale={locale} activeNavId="account" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t.accountSecurity.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.accountSecurity.subtitle}</p>
        </header>
        {status.outcome === "ok" ? (
          <TwoStepPanel status={status.data} t={t} locale={locale} />
        ) : (
          <Card>
            <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-base">
              <AlertTriangleIcon aria-hidden="true" className="size-5" />
              <p role="alert">
                {status.outcome === "unauthorized"
                  ? t.formErrors.unauthorized
                  : t.accountSecurity.loadError}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
