import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isNativeAuth } from "@/lib/auth/native";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { ChangePasswordForm } from "./change-password-form";

/**
 * Plan 1C: a signed-in staff member changes their own password. Native sign-in only: under Ory the
 * credential lives in Kratos. `middleware.ts` requires any signed-in role (viewer and up).
 */
export default async function ChangePasswordPage() {
  if (!isNativeAuth()) redirect("/");
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="account" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">
            Change password / تغيير كلمة السر
          </h1>
        </header>
        <ChangePasswordForm />
      </div>
    </AppShell>
  );
}
