import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { RobotsPolicyForm } from "@/components/seo/robots-policy-form";
import { fetchRobotsPolicy } from "@/lib/api/seo";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface NewRobotsPolicyPageProps {
  readonly searchParams: Promise<{ readonly policyId?: string }>;
}

/**
 * The Robots Policies create/set screen (T5.9b), gated to `operator`+ by `middleware.ts`. Also
 * serves as the edit UI: the list page's row link passes `?policyId=`, which is resolved here
 * (`GET /seo/robots-policies/:policyId`) to pre-fill `userAgent` and `rules`, since `POST
 * /seo/robots-policies` create-or-updates keyed by `userAgent` and there is no separate update
 * route.
 */
export default async function NewRobotsPolicyPage({ searchParams }: NewRobotsPolicyPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const { policyId } = await searchParams;

  const existing =
    policyId !== undefined && policyId.length > 0 ? await fetchRobotsPolicy(policyId) : undefined;
  const policy = existing?.outcome === "ok" ? existing.policy : undefined;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
          <Link href="/seo/robots-policies">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.robotsPolicyForm.back}
          </Link>
        </Button>
        <h1 className="text-4xl font-semibold tracking-tight">{t.robotsPolicyForm.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.robotsPolicyForm.subtitle}</p>
      </div>

      <Card>
        <CardContent>
          <RobotsPolicyForm t={t} defaultUserAgent={policy?.userAgent} defaultRules={policy?.rules} />
        </CardContent>
      </Card>
    </div>
  );
}
