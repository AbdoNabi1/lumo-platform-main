import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, Label, NativeSelect } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CustomersPagination } from "@/components/customers/customers-pagination";
import { SettingsFrame } from "@/components/settings/settings-frame";
import { ActivityTable } from "@/components/settings/users/activity-table";
import { fetchStaff, fetchStaffActivity } from "@/lib/api/staff";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Rows per page; the API allows 1..50 and defaults to 25. */
const PAGE_SIZE = 25;

interface ActivityPageProps {
  readonly searchParams: Promise<{
    /** Filter to one person (their `principalExternalId`). */
    readonly member?: string;
    /** The opaque cursor of the current page, and the stack of earlier ones (see `CustomersPagination`). */
    readonly after?: string;
    readonly stack?: string;
  }>;
}

function StatePanel({
  icon,
  message,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly message: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-base">
        {icon}
        <p role="alert">{message}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Settings → Users and permissions → Activity (Wave 1e): who signed in, was invited, changed a role or
 * touched two-step, newest first, 25 per page, optionally for one person. Admin-only by the
 * middleware's `/settings` rule; the API enforces `staff:read_activity` itself, so a 403 is shown as
 * such. Paging keeps the filter and uses the customers list's cursor stack: a later page that is
 * empty keeps Previous.
 */
export default async function StaffActivityPage({ searchParams }: ActivityPageProps) {
  const { member, after, stack } = await searchParams;
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const k = t.usersActivity;
  const memberId = member !== undefined && member.length > 0 ? member : undefined;
  const cursor = after !== undefined && after.length > 0 ? after : undefined;
  const hasCursor = cursor !== undefined || (stack !== undefined && stack.length > 0);

  const [user, activity, staff] = await Promise.all([
    getCurrentUser(),
    fetchStaffActivity({
      ...(memberId === undefined ? {} : { member: memberId }),
      ...(cursor === undefined ? {} : { cursor }),
      limit: PAGE_SIZE,
    }),
    fetchStaff(),
  ]);
  const people = staff.outcome === "ok" ? staff.data.items : [];

  let body: React.ReactNode;
  if (activity.outcome === "unauthorized") {
    body = (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={activity.status === 403 ? k.forbidden : k.unauthorized}
      />
    );
  } else if (activity.outcome !== "ok") {
    body = (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={k.loadError}
      />
    );
  } else if (activity.data.items.length === 0) {
    body = (
      <StatePanel icon={<SearchXIcon aria-hidden="true" className="size-5" />} message={k.empty}>
        {hasCursor && <CustomersPagination hasNextPage={false} endCursor={null} t={t} />}
      </StatePanel>
    );
  } else {
    body = (
      <Card>
        <CardContent className="p-0 sm:p-0">
          <ActivityTable items={activity.data.items} t={t} locale={locale} />
        </CardContent>
        <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
          <CustomersPagination
            hasNextPage={activity.data.nextCursor !== null}
            endCursor={activity.data.nextCursor}
            t={t}
          />
        </div>
      </Card>
    );
  }

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <SettingsFrame t={t} activeId="users">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <header className="flex flex-col gap-2">
            <Link
              href="/settings/users"
              className="text-muted-foreground inline-flex items-center gap-1 text-sm underline"
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              {k.back}
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">{k.title}</h1>
            <p className="text-muted-foreground text-sm">{k.subtitle}</p>
          </header>

          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-56 flex-col gap-1.5">
              <Label htmlFor="activity-member">{k.filterLabel}</Label>
              <NativeSelect id="activity-member" name="member" defaultValue={memberId ?? ""}>
                <option value="">{k.filterAll}</option>
                {people.map((person) => (
                  <option key={person.principalExternalId} value={person.principalExternalId}>
                    {person.email}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline">
              {k.filterApply}
            </Button>
          </form>

          {body}
        </div>
      </SettingsFrame>
    </AppShell>
  );
}
