import { cookies } from "next/headers";
import { MegaphoneIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * The Marketing screen (Phase A.30). Audited: no `services/marketing` context, no campaign
 * aggregate anywhere in the codebase — only a bare `campaignRef` string on Coupon/Promotion with
 * no owning data. Building a campaigns list here would mean inventing status/channels/dates/
 * performance metrics wholesale, which the task's "never fabricate" rule forbids. This screen
 * states that gap honestly instead.
 *
 * Re-audited at T5.14 (Phase 5): still no `services/marketing` context anywhere in `services/*`;
 * `campaignRef` in both `apps/admin-web/src/lib/api/promotions.ts` and `.../discounts.ts` remains
 * an opaque optional string with no backing entity or endpoint. Gap unchanged.
 */
export default async function MarketingPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="marketing" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">{t.marketingPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.marketingPage.subtitle}</p>
        </header>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <span
              className="bg-secondary text-secondary-foreground flex size-12 items-center justify-center rounded-2xl"
              aria-hidden="true"
            >
              <MegaphoneIcon className="size-6" />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t.marketingPage.unavailableTitle}
            </h2>
            <p className="text-muted-foreground max-w-xl text-sm">
              {t.marketingPage.unavailableBody}
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
