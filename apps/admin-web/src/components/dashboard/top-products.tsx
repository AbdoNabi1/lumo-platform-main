import Link from "next/link";
import {
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
import { ProductThumb } from "@/components/products/product-thumb";
import type { SalesTopProductDto } from "@/lib/api/sales-analytics";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Top products by units sold in the range: the picture, the product and its variant, the units and
 * the sales. Only what orders can honestly say: there is no views, conversion or stock column because
 * none of those is counted from orders. The table sits inside its own scroll region (supplied by
 * `Table`), which keeps the page free of horizontal overflow on a 390px viewport.
 */
export function TopProducts({
  products,
  currency,
  t,
  locale,
  className,
}: {
  readonly products: readonly SalesTopProductDto[];
  readonly currency: string;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle as="h2">{t.topProducts.title}</CardTitle>
        <Button variant="outline" size="sm" asChild>
          <Link href="/products">{t.topProducts.viewAll}</Link>
        </Button>
      </CardHeader>

      {products.length === 0 ? (
        <CardContent className="text-muted-foreground px-4 py-10 text-center text-base sm:px-5">
          <p role="note">{t.topProducts.empty}</p>
        </CardContent>
      ) : (
        <CardContent className="px-0 sm:px-0">
          <Table aria-label={t.topProducts.tableLabel}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.topProducts.product}</TableHead>
                <TableHead className="text-end">{t.topProducts.units}</TableHead>
                <TableHead className="text-end">{t.topProducts.sales}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={`${product.productRef}:${product.variantRef ?? ""}`}>
                  <TableHead scope="row" className="text-foreground h-auto py-3 font-medium">
                    <div className="flex items-center gap-3">
                      <ProductThumb url={product.imageUrl} alt={product.name} />
                      <div className="min-w-0">
                        <Link
                          href={`/products/${product.productRef}`}
                          className="hover:text-primary"
                        >
                          {product.name}
                        </Link>
                        {product.variantTitle !== null && (
                          <p className="text-muted-foreground text-sm font-normal">
                            {product.variantTitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableHead>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(locale, product.quantity)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatCurrency(locale, product.salesMinor, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
