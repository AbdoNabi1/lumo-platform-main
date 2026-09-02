import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, MailIcon, SearchXIcon } from "lucide-react";
import { Avatar, AvatarFallback, Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CustomerAddressesCard } from "@/components/customers/customer-addresses-card";
import { CustomerConsentCard } from "@/components/customers/customer-consent-card";
import { CustomerIdentityTimelineCard } from "@/components/customers/customer-identity-timeline-card";
import {
  CustomerOrdersCard,
  CustomerOrdersCardSkeleton,
} from "@/components/customers/customer-orders-card";
import { CustomerProfileCard } from "@/components/customers/customer-profile-card";
import { fetchCustomerProfile, fetchIdentityTimeline } from "@/lib/api/customer-360";
import { fetchCustomer } from "@/lib/api/customers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

interface CustomerDetailPageProps {
  readonly params: Promise<{ readonly customerId: string }>;
}

/**
 * The Customer Detail screen (Phase A.30). Resolves the real `GET /customers/:customerId`
 * endpoint. Related orders get their own `<Suspense>` boundary (separate bounded context, Orders)
 * so a slow/failed cross-context read never blocks the customer profile itself from rendering —
 * same streaming discipline as the Order Detail screen.
 *
 * T3.3 adds the Customer 360 "Unified profile" and "Identity timeline" cards, keyed on this
 * customer's own id as a `customer_id` identifier (`lib/api/customer-360.ts`,
 * `customer360:read`). Both fetches run in `Promise.all` alongside `fetchCustomer` so the page
 * doesn't serialise three round trips; unlike the Orders card they are not given their own
 * `<Suspense>` boundary because they read off the same request as the customer lookup itself, not
 * a separately-streamed cross-context call. The Customer 360 journey endpoints
 * (`fetchJourneyTimeline`/`fetchJourneyState`) are keyed on `visitorId`, which
 * `CustomerDetailDto` (`lib/api/customers.ts`) does not carry — there is no real visitor id to
 * fetch them with here, so those two cards are intentionally omitted rather than fabricated (see
 * the T3.3 entry in `docs/plans/BLOCKERS.md`).
 */
export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { customerId } = await params;

  const [result, profileResult, identityTimelineResult] = await Promise.all([
    fetchCustomer(customerId),
    fetchCustomerProfile("customer_id", customerId),
    fetchIdentityTimeline("customer_id", customerId),
  ]);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="customers" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.customerDetail.unauthorized}
          backLabel={t.customerDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="customers" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.customerDetail.notFound}
          backLabel={t.customerDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="customers" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.customerDetail.error}
          backLabel={t.customerDetail.back}
        />
      </AppShell>
    );
  }

  const customer = result.customer;

  return (
    <AppShell t={t} locale={locale} activeNavId="customers" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/customers">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.customerDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback>{initialsOf(customer.name)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">{customer.name}</h1>
              <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
                <MailIcon aria-hidden="true" className="size-4" />
                {customer.email}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {t.customerDetail.customerReference}: <span className="font-mono">{customer.id}</span>
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <Suspense fallback={<CustomerOrdersCardSkeleton t={t} />}>
              <CustomerOrdersCard customerId={customer.id} t={t} locale={locale} />
            </Suspense>
          </div>

          <div className="flex flex-col gap-6">
            <CustomerAddressesCard addresses={customer.addresses} t={t} />
            <CustomerConsentCard consents={customer.consents} t={t} locale={locale} />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <CustomerProfileCard result={profileResult} t={t} locale={locale} />
          <CustomerIdentityTimelineCard result={identityTimelineResult} t={t} locale={locale} />
        </div>
      </div>
    </AppShell>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/customers">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
