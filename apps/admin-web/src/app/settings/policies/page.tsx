import { cookies } from "next/headers";
import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { POLICY_TITLES, POLICY_TYPES, type PolicyType } from "@platform/storefront-content";
import { AppShell } from "@/components/app-shell";
import { PolicyCard } from "@/components/online-store/policy-card";
import {
  fetchPolicies,
  fetchPolicy,
  fetchPreferences,
  type PolicyDto,
  type PolicySummaryDto,
} from "@/lib/api/online-store";
import type { ApiResult } from "@/lib/api/client";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { policyTemplateDefaults } from "@/lib/online-store/policy-defaults";

/** Set when the list says so; without the list, when either language has text. */
function isSet(policy: PolicyDto, summaries: readonly PolicySummaryDto[] | null): boolean {
  const summary = summaries?.find((row) => row.type === policy.type);
  if (summary !== undefined) return summary.set;
  return (policy.body.ar ?? "").trim() !== "" || (policy.body.en ?? "").trim() !== "";
}

/**
 * Settings → Policies (spec 2.3, 2.7): the five store policies, each in its own card. Viewers read
 * them (`ROUTE_ROLE_REQUIREMENTS`); editing needs an operator. The template dialog starts from the
 * store name (Online Store preferences) and, only when that read succeeds (admins), the store's
 * contact email (Ruling 20). The API enforces every permission itself.
 */
export default async function PoliciesPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, summaries, preferences, storeSettings, ...policies] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchPolicies(),
    fetchPreferences(),
    fetchStoreSettings(),
    ...POLICY_TYPES.map((type) => fetchPolicy(type)),
  ]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";
  const storefrontUrl = process.env["STOREFRONT_URL"]?.trim() || null;
  const defaults = policyTemplateDefaults(
    preferences.outcome === "ok" ? preferences.data : null,
    storeSettings.outcome === "ok" ? storeSettings.settings : null,
  );
  const summaryRows = summaries.outcome === "ok" ? summaries.data : null;
  const reads = POLICY_TYPES.map(
    (type, index): readonly [PolicyType, ApiResult<PolicyDto> | undefined] => [
      type,
      policies[index],
    ],
  );

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t.policies.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.policies.subtitle}</p>
          {canEdit ? null : (
            <p role="note" className="text-muted-foreground mt-2 text-sm">
              {t.policies.readOnly}
            </p>
          )}
        </header>
        {reads.map(([type, read]) =>
          read?.outcome === "ok" ? (
            <PolicyCard
              key={type}
              t={t}
              locale={locale}
              type={type}
              title={POLICY_TITLES[type][locale]}
              policy={read.data}
              set={isSet(read.data, summaryRows)}
              canEdit={canEdit}
              defaults={defaults}
              storefrontUrl={storefrontUrl}
            />
          ) : (
            <Card key={type}>
              <CardContent>
                <h2 className="text-base font-semibold">{POLICY_TITLES[type][locale]}</h2>
                <p role="alert" className="text-destructive mt-2 flex items-center gap-2 text-sm">
                  <AlertTriangleIcon aria-hidden="true" className="size-4" />
                  {read?.outcome === "unauthorized" ? t.formErrors.forbidden : t.policies.loadError}
                </p>
              </CardContent>
            </Card>
          ),
        )}
      </div>
    </AppShell>
  );
}
