"use client";

import { useActionState, useId } from "react";
import Link from "next/link";
import { Badge, Button, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import { advanceCouponAction } from "@/app/discounts/actions";
import type { CouponListItemDto } from "@/lib/api/discounts";
import { couponAdvanceableStatusesFrom } from "@/lib/coupon-lifecycle";
import type { FormState } from "@/lib/api/mutation";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const STATUS_VARIANT: Readonly<Record<string, "success" | "outline" | "warning" | "neutral">> = {
  active: "success",
  disabled: "outline",
  expired: "outline",
  depleted: "warning",
};

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-8 rounded-xl border px-2.5 text-xs transition-colors ease-out";

/**
 * The Discounts list's table (T5.8 Part A), extracted to a Client Component so each row can carry
 * its own "advance status" control — same "no detail page, per-row inline actions" discipline
 * `ContentBlocksTable` established for the Content Blocks list.
 */
export function DiscountsTable({
  items,
  t,
  locale,
}: {
  readonly items: readonly CouponListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Table aria-label={t.discountsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.discountsPage.columns.code}</TableHead>
          <TableHead>{t.discountsPage.columns.status}</TableHead>
          <TableHead>{t.discountsPage.columns.usage}</TableHead>
          <TableHead>{t.discountsPage.columns.expires}</TableHead>
          <TableHead>{t.discountsPage.columns.promotion}</TableHead>
          <TableHead className="text-end">{t.discountsRowActions.actions}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((coupon) => (
          <TableRow key={coupon.id}>
            <TableCell className="font-mono font-medium">{coupon.code}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[coupon.status] ?? "neutral"}>
                {(t.discountStatus as Record<string, string>)[coupon.status] ?? coupon.status}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums">
              {coupon.usageCount}
              {coupon.usageLimit !== null
                ? ` / ${coupon.usageLimit}`
                : ` (${t.discountsPage.unlimited})`}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {coupon.expiresAt !== null
                ? formatDateTime(locale, coupon.expiresAt)
                : t.discountsPage.noExpiry}
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              <Link href={`/promotions/${encodeURIComponent(coupon.promotionRef)}`} className="hover:underline">
                {coupon.promotionRef}
              </Link>
            </TableCell>
            <TableCell className="text-end">
              <AdvanceForm coupon={coupon} t={t} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AdvanceForm({ coupon, t }: { readonly coupon: CouponListItemDto; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(advanceCouponAction, INITIAL_STATE);
  const formId = useId();
  const targets = couponAdvanceableStatusesFrom(coupon.status);

  if (targets.length === 0) return null;

  return (
    <form action={formAction} className="flex items-center justify-end gap-1.5">
      <input type="hidden" name="couponId" value={coupon.id} />
      <Label htmlFor={`${formId}-toStatus`} className="sr-only">
        {t.discountsRowActions.advanceToLabel}
      </Label>
      <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
        {targets.map((status) => (
          <option key={status} value={status}>
            {(t.discountStatus as Record<string, string>)[status] ?? status}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
        {isPending ? t.discountsRowActions.advancing : t.discountsRowActions.advance}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}
