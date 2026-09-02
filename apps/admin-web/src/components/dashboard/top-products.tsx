import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { DataProvenance, StockState, TopProduct } from "@/data/dashboard";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

function stockBadge(stock: StockState, t: Dictionary) {
  switch (stock.kind) {
    case "in-stock":
      return <Badge variant="success">{t.topProducts.inStock}</Badge>;
    case "low":
      return (
        <Badge variant="warning">
          {t.topProducts.low.replace("{count}", String(stock.available))}
        </Badge>
      );
    case "out-of-stock":
      return <Badge variant="destructive">{t.topProducts.outOfStock}</Badge>;
  }
}

/**
 * Top products. The table sits inside its own scroll region (supplied by `Table`), which
 * is what keeps the page free of horizontal overflow on a 390px viewport.
 */
export function TopProducts({
  products,
  provenance,
  t,
  locale,
  className,
}: {
  readonly products: readonly TopProduct[];
  readonly provenance: DataProvenance;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{t.topProducts.title}</CardTitle>
            {provenance === "demo" && <Badge variant="warning">{t.data.demoTag}</Badge>}
          </div>
          {provenance === "demo" && (
            <p role="note" className="text-muted-foreground text-xs">
              {t.topProducts.demoExplanation}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/products">{t.topProducts.viewAll}</Link>
        </Button>
      </CardHeader>

      <CardContent className="px-0 sm:px-0">
        <Table aria-label={t.topProducts.tableLabel}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.topProducts.product}</TableHead>
              <TableHead className="text-end">{t.topProducts.sold}</TableHead>
              <TableHead className="text-end">{t.topProducts.revenue}</TableHead>
              <TableHead className="text-end">{t.topProducts.views}</TableHead>
              <TableHead className="text-end">{t.topProducts.conversion}</TableHead>
              <TableHead>{t.topProducts.stock}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableHead scope="row" className="text-foreground h-auto py-3 font-medium">
                  <Link href={`/products/${product.id}`} className="hover:text-primary">
                    {product.name}
                  </Link>
                </TableHead>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(locale, product.unitsSold)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatCurrency(locale, product.revenue.amountMinor, product.revenue.currency)}
                </TableCell>
                <TableCell className="text-muted-foreground text-end tabular-nums">
                  {formatNumber(locale, product.views)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatPercent(locale, product.conversion)}
                </TableCell>
                <TableCell>{stockBadge(product.stock, t)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
