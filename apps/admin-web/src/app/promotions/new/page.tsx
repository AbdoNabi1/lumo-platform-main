import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { PromotionCreateForm } from "@/components/promotions/promotion-create-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The Promotions create screen (T5.8 Part B) — gated to `operator`+ by `middleware.ts`. */
export default async function NewPromotionPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="promotions" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/promotions">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.promotionDetail.back}
            </Link>
          </Button>
          <h1 className="text-4xl font-semibold tracking-tight">{t.promotionCreate.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.promotionCreate.subtitle}</p>
        </div>

        <Card>
          <CardContent>
            <PromotionCreateForm t={t} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
