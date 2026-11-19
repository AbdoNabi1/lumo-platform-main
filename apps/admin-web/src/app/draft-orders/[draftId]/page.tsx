import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DraftOrderEditor } from "@/components/draft-orders/draft-order-editor";
import { fetchDraftOrder } from "@/lib/api/draft-orders";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { canEditDrafts, canMarkDraftPaid } from "@/lib/orders/draft-orders";

/** One draft order (spec §4.9). Viewers read it; the editor is read-only for them. */
export default async function DraftOrderPage({
  params,
}: {
  readonly params: Promise<{ readonly draftId: string }>;
}) {
  const { draftId } = await params;
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const role = highestRole((await readSession())?.roles ?? []);
  const result = await fetchDraftOrder(draftId);
  if (result.outcome === "not_found") notFound();
  return (
    <AppShell t={t} locale={locale} activeNavId="draft-orders" user={user}>
      {result.outcome === "ok" ? (
        <DraftOrderEditor
          draft={result.data}
          canEdit={canEditDrafts(role)}
          canMarkPaid={canMarkDraftPaid(role)}
          t={t}
          locale={locale}
        />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center">
            <AlertTriangleIcon aria-hidden="true" className="size-5" />
            <p role="note" className="text-foreground font-medium">
              {result.outcome === "unauthorized" ? t.draftOrders.unauthorized : t.draftOrders.error}
            </p>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
