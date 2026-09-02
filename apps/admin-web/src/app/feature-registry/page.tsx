import { Suspense } from "react";
import { cookies } from "next/headers";
import { Card, CardContent, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { BundlesPanel } from "@/components/feature-registry/bundles-panel";
import { CapabilityGraphPanel } from "@/components/feature-registry/capability-graph-panel";
import { FeatureKeySearch } from "@/components/feature-registry/feature-key-search";
import { FeaturesPanel } from "@/components/feature-registry/features-panel";
import { ResolvePanel } from "@/components/feature-registry/resolve-panel";
import { ValidationSummary } from "@/components/feature-registry/validation-summary";
import {
  fetchCapabilityGraph,
  fetchFeatureBundles,
  fetchFeatures,
  fetchRegistryValidation,
  resolveFeature,
} from "@/lib/api/feature-registry";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface FeatureRegistryPageProps {
  readonly searchParams: Promise<{ readonly key?: string }>;
}

/**
 * `/feature-registry` (T3.4) — the Feature Registry explorer over five read-only endpoints
 * (`apps/admin/src/http/feature-registry-routes.ts`): the feature catalog, per-key resolution,
 * bundles, the capability graph, and the whole-registry validation report. Same streaming shell
 * as Orders/Finance: the chrome and the key-search box render immediately, the five GETs resolve
 * together inside one `<Suspense>` boundary keyed on `?key=`.
 *
 * The capability graph renders as a plain from/to/relationship edge table
 * (`CapabilityGraphPanel`, `deriveCapabilityEdges` in `lib/api/feature-registry.ts`) — deliberately
 * not a drawn graph; see the T3.4 brief and that module's doc comment for why.
 */
export default async function FeatureRegistryPage({ searchParams }: FeatureRegistryPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  const key = params.key?.trim();

  return (
    <AppShell t={t} locale={locale} activeNavId="feature-registry" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">{t.featureRegistryPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.featureRegistryPage.subtitle}</p>
        </header>

        <FeatureKeySearch t={t} />

        <Suspense key={key ?? ""} fallback={<RegistrySkeleton />}>
          <RegistryContent keyParam={key} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function RegistryContent({
  keyParam,
  t,
}: {
  readonly keyParam: string | undefined;
  readonly t: Dictionary;
}) {
  const hasKey = keyParam !== undefined && keyParam.length > 0;
  const [featuresResult, bundlesResult, graphResult, validationResult, resolveResult] =
    await Promise.all([
      fetchFeatures(),
      fetchFeatureBundles(),
      fetchCapabilityGraph(),
      fetchRegistryValidation(),
      hasKey ? resolveFeature(keyParam) : undefined,
    ]);

  const features = featuresResult.outcome === "ok" ? featuresResult.features : [];

  return (
    <div className="flex flex-col gap-6">
      {resolveResult !== undefined ? (
        <ResolvePanel result={resolveResult} keyParam={keyParam ?? ""} t={t} />
      ) : null}

      <ValidationSummary result={validationResult} t={t} />

      <Tabs defaultValue="features">
        <TabsList>
          <TabsTrigger value="features">{t.featureRegistryPage.tabs.features}</TabsTrigger>
          <TabsTrigger value="bundles">{t.featureRegistryPage.tabs.bundles}</TabsTrigger>
          <TabsTrigger value="graph">{t.featureRegistryPage.tabs.graph}</TabsTrigger>
        </TabsList>

        <TabsContent value="features">
          <FeaturesPanel
            result={
              featuresResult.outcome === "ok"
                ? { outcome: "ok", data: featuresResult.features }
                : featuresResult
            }
            t={t}
          />
        </TabsContent>

        <TabsContent value="bundles">
          <BundlesPanel
            result={
              bundlesResult.outcome === "ok"
                ? { outcome: "ok", data: bundlesResult.bundles }
                : bundlesResult
            }
            t={t}
          />
        </TabsContent>

        <TabsContent value="graph">
          <CapabilityGraphPanel graphResult={graphResult} features={features} t={t} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RegistrySkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
