import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { ChevronRightIcon, MegaphoneIcon, PercentIcon, WorkflowIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * The Marketing overview, Shopify's top-level Marketing page. There is no campaign model in the
 * platform yet (only an opaque `campaignRef` string on coupons and promotions), so this page never
 * shows campaign figures: it says campaigns are on the way, in the merchant's words, and links to
 * the marketing tools that do exist — automations and discount codes.
 */
export default async function MarketingPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const copy = t.marketingPage;

  return (
    <AppShell t={t} locale={locale} activeNavId="marketing" user={user}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{copy.subtitle}</p>
        </header>

        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span
              className="bg-secondary text-secondary-foreground flex size-12 items-center justify-center rounded-2xl"
              aria-hidden="true"
            >
              <MegaphoneIcon className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">{copy.campaignsTitle}</h2>
            <p className="text-muted-foreground max-w-md text-sm">{copy.campaignsBody}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="divide-border flex flex-col divide-y p-0">
            <ToolLink
              href="/automations"
              icon={<WorkflowIcon aria-hidden="true" className="text-muted-foreground size-5" />}
              title={copy.automationsTitle}
              body={copy.automationsBody}
            />
            <ToolLink
              href="/discounts"
              icon={<PercentIcon aria-hidden="true" className="text-muted-foreground size-5" />}
              title={copy.discountsTitle}
              body={copy.discountsBody}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function ToolLink({
  href,
  icon,
  title,
  body,
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <Link href={href} className="hover:bg-muted/50 flex items-center gap-3 p-4">
      {icon}
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-sm">{body}</span>
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className="text-muted-foreground size-4 rtl:rotate-180"
      />
    </Link>
  );
}
