import { Card, CardContent, CardHeader, Skeleton } from "@platform/ui";
import { fetchRecentOrders } from "@/lib/api/orders";
import { fetchPaymentSettings } from "@/lib/api/payments";
import { fetchProductsPage } from "@/lib/api/products";
import { fetchShippingZones } from "@/lib/api/shipping-zones";
import { fetchMyDomains } from "@/lib/api/store-domains";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { buildSetupSteps, setupGuideVisible, type SetupFacts } from "@/lib/dashboard/setup-guide";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SetupGuide } from "./setup-guide";

/** A request that fails (or throws) is an unknown fact, never an error: the guide still shows. */
async function fact<T>(load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

/**
 * Resolves what the guide needs from the API, in parallel, and renders it. An async Server Component
 * rendered in its own `<Suspense>` boundary in `app/page.tsx`, so Home's figures never wait on it. Any
 * fact that cannot be loaded is `null` (the step reads as not done): a failing request neither hides
 * the guide nor breaks Home.
 */
export async function SetupGuideSection({
  t,
  locale,
  welcome,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  /** `?welcome=1`, the sign-up redirect: greets the new merchant above the guide. */
  readonly welcome: boolean;
}) {
  const [products, zones, payments, domains, orders, settings] = await Promise.all([
    fact(async () => {
      const result = await fetchProductsPage({ first: 1 });
      return result.outcome === "ok" ? result.items.length : null;
    }),
    fact(async () => {
      const result = await fetchShippingZones();
      return result.outcome === "ok" ? result.zones.length : null;
    }),
    fact(async () => {
      const result = await fetchPaymentSettings();
      return result.outcome === "ok" ? result.settings.enabledMethods.length : null;
    }),
    fact(async () => {
      const result = await fetchMyDomains();
      return result.outcome === "ok"
        ? result.domains.some((domain) => domain.kind === "custom" && domain.status === "verified")
        : null;
    }),
    fact(async () => {
      const result = await fetchRecentOrders(1);
      return result.outcome === "ok" ? result.orders.length : null;
    }),
    fact(async () => {
      const result = await fetchStoreSettings();
      return result.outcome === "ok" ? result.settings : null;
    }),
  ]);

  const facts: SetupFacts = {
    productCount: products,
    shippingZoneCount: zones,
    enabledPaymentMethods: payments,
    hasVerifiedCustomDomain: domains,
    orderCount: orders,
  };
  const steps = buildSetupSteps(facts);
  const visible = setupGuideVisible(steps, settings?.setupGuideDismissedAt);

  if (!welcome && !visible) return null;
  return (
    <div className="flex flex-col gap-4">
      {welcome && (
        <p role="status" className="text-lg font-medium">
          {t.setupGuide.welcome}
        </p>
      )}
      {visible && <SetupGuide steps={steps} t={t} locale={locale} />}
    </div>
  );
}

/** `<Suspense>` fallback for {@link SetupGuideSection}. */
export function SetupGuideSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true" aria-label={t.setupGuide.title}>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}
