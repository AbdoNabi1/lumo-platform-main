import { provinceName } from "@platform/regions";
import type { PackingSlipDto } from "@/lib/api/orders";
import { formatCurrency, formatLongDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** One printed slip (one per page: `break-after-page`). "Collect: …" only when cash is due on delivery. */
export function PackingSlip({
  slip,
  shopName,
  timeZone,
  t,
  locale,
}: {
  readonly slip: PackingSlipDto;
  readonly shopName: string;
  /** The shop's IANA time zone (store settings): the date is the shop's day, as in the CSV. */
  readonly timeZone: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const p = t.packingSlips;
  const to = slip.shipTo;
  const cityLine = [to.city, to.province === null ? null : provinceName(to.province, locale)]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(", ");
  return (
    <article className="flex break-after-page flex-col gap-5 p-8 print:p-0">
      <header className="border-border flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <p className="text-lg font-semibold">{shopName}</p>
          <h2 className="text-base font-medium">
            {p.orderLabel.replace("{orderNumber}", slip.orderNumber)}
          </h2>
        </div>
        <p className="text-sm">{formatLongDate(locale, slip.createdAt, timeZone)}</p>
      </header>
      <section>
        <h3 className="mb-1 text-sm font-semibold">{p.shipTo}</h3>
        <address className="text-sm not-italic leading-6">
          {to.name !== null && <div>{to.name}</div>}
          {to.phone !== null && (
            <div dir="ltr" className="text-start">
              {to.phone}
            </div>
          )}
          <div>{to.line1}</div>
          {to.line2 !== null && <div>{to.line2}</div>}
          <div>{cityLine}</div>
          <div>{[to.postalCode, to.country].filter((part) => part.length > 0).join(" ")}</div>
        </address>
      </section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-1 text-start font-semibold">{p.items}</th>
            <th className="py-1 text-end font-semibold">{p.quantity}</th>
          </tr>
        </thead>
        <tbody>
          {slip.lines.map((line, index) => (
            <tr key={`${line.title}-${index}`} className="border-border border-b">
              <td className="py-1">
                <div>{line.title}</div>
                {line.variantTitle !== null && (
                  <div className="text-muted-foreground">{line.variantTitle}</div>
                )}
                {line.sku !== null && (
                  <div className="text-muted-foreground">{p.sku.replace("{sku}", line.sku)}</div>
                )}
              </td>
              <td className="py-1 text-end tabular-nums">{formatNumber(locale, line.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {slip.note !== null && (
        <section>
          <h3 className="mb-1 text-sm font-semibold">{p.note}</h3>
          <p className="whitespace-pre-wrap text-sm">{slip.note}</p>
        </section>
      )}
      {slip.codAmountMinor > 0 && (
        <p className="border-foreground rounded-md border-2 px-3 py-2 text-lg font-bold">
          {p.collect.replace(
            "{amount}",
            formatCurrency(locale, slip.codAmountMinor, slip.currency),
          )}
        </p>
      )}
    </article>
  );
}
