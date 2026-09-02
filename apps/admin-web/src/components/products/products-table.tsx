import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { ProductListItemDto } from "@/lib/api/products";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ProductStatusBadge } from "./product-status-badge";

export function ProductsTable({
  products,
  t,
  locale,
}: {
  readonly products: readonly ProductListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Table aria-label={t.productsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.productsPage.columns.product}</TableHead>
          <TableHead>{t.productsPage.columns.sku}</TableHead>
          <TableHead>{t.productsPage.columns.status}</TableHead>
          <TableHead className="text-end">{t.productsPage.columns.variants}</TableHead>
          <TableHead className="text-end">{t.productsPage.columns.price}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id}>
            <TableCell className="font-medium">
              <Link
                href={`/products/${product.id}`}
                className="hover:text-primary"
                aria-label={t.productsPage.viewProduct.replace("{name}", product.name)}
              >
                {product.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">{product.sku}</TableCell>
            <TableCell>
              <ProductStatusBadge status={product.status} t={t} />
            </TableCell>
            <TableCell className="text-end tabular-nums">{product.variantCount}</TableCell>
            <TableCell className="text-end font-medium tabular-nums">
              {product.priceAmountMinor !== null && product.currency !== null
                ? formatCurrency(locale, product.priceAmountMinor, product.currency)
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
