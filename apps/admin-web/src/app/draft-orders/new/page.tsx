import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { DraftOrderEditor } from "@/components/draft-orders/draft-order-editor";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { canEditDrafts, canMarkDraftPaid } from "@/lib/orders/draft-orders";

/** Orders → Create order (spec §4.9): a new draft. Operators and up (middleware). */
export default async function NewDraftOrderPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const role = highestRole((await readSession())?.roles ?? []);
  return (
    <AppShell t={t} locale={locale} activeNavId="draft-orders" user={user}>
      <DraftOrderEditor
        draft={null}
        canEdit={canEditDrafts(role)}
        canMarkPaid={canMarkDraftPaid(role)}
        t={t}
        locale={locale}
      />
    </AppShell>
  );
}
