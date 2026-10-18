import { cookies } from "next/headers";
import { AutoPrint } from "@/components/orders/auto-print";
import { PackingSlip } from "@/components/orders/packing-slip";
import { fetchPackingSlips } from "@/lib/api/orders";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { parseOrderIds } from "@/lib/orders/order-views";

const MAX_SLIPS = 50;

function SlipsMessage({ text }: { readonly text: string }) {
  return (
    <p role="note" className="text-muted-foreground p-8 text-center text-base">
      {text}
    </p>
  );
}

/** Packing slips for up to 50 orders (`?ids=a,b`), one per printed page, printing on open (spec §1.5). */
export default async function PackingSlipsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly ids?: string }>;
}) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const { ids: raw } = await searchParams;
  const ids = parseOrderIds(raw, MAX_SLIPS);
  if (ids === null) {
    const tooMany = (parseOrderIds(raw, Number.MAX_SAFE_INTEGER)?.length ?? 0) > MAX_SLIPS;
    return <SlipsMessage text={tooMany ? t.packingSlips.tooMany : t.packingSlips.empty} />;
  }
  const [result, settings] = await Promise.all([fetchPackingSlips(ids), storeSettingsOrDefaults()]);
  if (result.outcome !== "ok") return <SlipsMessage text={t.packingSlips.error} />;
  if (result.slips.length === 0) return <SlipsMessage text={t.packingSlips.empty} />;
  return (
    <main
      dir={directionFor(locale)}
      className="bg-background text-foreground mx-auto max-w-3xl print:max-w-none"
    >
      <style>{"@page { margin: 12mm; }"}</style>
      <h1 className="sr-only">{t.packingSlips.title}</h1>
      {result.slips.map((slip) => (
        <PackingSlip
          key={slip.orderId}
          slip={slip}
          shopName={settings.storeName}
          t={t}
          locale={locale}
        />
      ))}
      <AutoPrint />
    </main>
  );
}
