import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CollectionDeleteDialog } from "@/components/collections/collection-delete-dialog";
import { CollectionProductsCard } from "@/components/collections/collection-products-card";
import {
  CollectionStatusCard,
  CollectionTitleCard,
} from "@/components/collections/collection-settings-cards";
import { fetchCollection, fetchCollectionMembers } from "@/lib/api/collections";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  MEMBERS_PAGE_SIZE,
  membersCursor,
  parseMembersPage,
} from "@/lib/collections/collection-helpers";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface CollectionPageProps {
  readonly params: Promise<{ readonly collectionId: string }>;
  readonly searchParams: Promise<{ readonly membersPage?: string | string[] }>;
}

/**
 * Shopify parity Wave 1a — one collection (`GET /collections/:id`): Title, Status, and Products
 * in collection order, 50 to a page (`?membersPage=`), with Move up / Move down / Remove / Browse.
 */
export default async function CollectionPage({ params, searchParams }: CollectionPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const [{ collectionId }, query] = await Promise.all([params, searchParams]);
  const membersPage = parseMembersPage(query.membersPage);
  const after = membersCursor(membersPage);

  const [result, members] = await Promise.all([
    fetchCollection(collectionId),
    fetchCollectionMembers(collectionId, {
      first: MEMBERS_PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    }),
  ]);

  if (result.outcome === "not_found") notFound();
  if (result.outcome !== "ok") {
    const unauthorized = result.outcome === "unauthorized";
    return (
      <AppShell t={t} locale={locale} activeNavId="collections" user={user}>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
          <Card>
            <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
              <StateIcon unauthorized={unauthorized} />
              <p role="note">{unauthorized ? t.collections.unauthorized : t.collections.error}</p>
              <Button variant="outline" asChild>
                <Link href="/collections">
                  <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
                  {t.collections.back}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  if (members.outcome === "not_found") notFound();

  const collection = result.collection;
  return (
    <AppShell t={t} locale={locale} activeNavId="collections" user={user}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/collections">
              <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
              {t.collections.back}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                <bdi dir="auto">{collection.name}</bdi>
              </h1>
              <Badge variant={collection.status === "published" ? "success" : "neutral"}>
                {collection.status === "published"
                  ? t.collections.statusPublished
                  : t.collections.statusDraft}
              </Badge>
            </div>
            <CollectionDeleteDialog collectionId={collection.id} name={collection.name} t={t} />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <CollectionTitleCard
              key={`${collection.name}|${collection.slug}`}
              collectionId={collection.id}
              name={collection.name}
              slug={collection.slug}
              t={t}
            />
            <CollectionProductsCard
              collectionId={collection.id}
              productIds={collection.productIds}
              members={members.outcome === "ok" ? members.items : []}
              membersPage={membersPage}
              hasNextPage={members.outcome === "ok" && members.pageInfo.hasNextPage}
              loadFailed={members.outcome !== "ok"}
              t={t}
            />
          </div>
          <div className="flex flex-col gap-4">
            <CollectionStatusCard
              key={collection.status}
              collectionId={collection.id}
              status={collection.status}
              t={t}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StateIcon({ unauthorized }: { readonly unauthorized: boolean }): ReactNode {
  return unauthorized ? (
    <LockIcon aria-hidden="true" className="size-5" />
  ) : (
    <AlertTriangleIcon aria-hidden="true" className="size-5" />
  );
}
