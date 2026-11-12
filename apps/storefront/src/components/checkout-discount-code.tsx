"use client";

import { useId, useState, useTransition } from "react";
import { TagIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { applyDiscountCode, removeDiscountCode } from "@/app/checkout/actions";
import type { CheckoutDiscountCodeSummary } from "@/lib/runtime-api";
import type { Dictionary } from "@/messages/en";

/** The failures the checkout view words with its own error banner. */
export type DiscountCodeFailure = "ownership" | "validation" | "unavailable" | "network";

/**
 * The shopper-facing sentence for a reason token (a rejected code, or a chip that doesn't apply).
 * A token this build has no copy for, or none at all, reads as the generic message, so a reason
 * the runtime adds later never shows up as a raw token.
 */
export function discountReasonMessage(reason: string | null, t: Dictionary): string {
  const reasons: Readonly<Record<string, string>> = t.checkout.discount.reasons;
  return (
    (reason !== null && Object.hasOwn(reasons, reason) ? reasons[reason] : undefined) ??
    t.checkout.discount.genericReason
  );
}

/**
 * The "Discount code" field and the chips for the codes already entered, under the order summary's
 * line items (Shopify's layout). Only the typed code leaves the browser: the runtime derives every
 * amount, and the actions revalidate `/checkout`, so the summary refreshes on its own afterwards.
 */
export function CheckoutDiscountCode({
  checkoutSessionId,
  codes,
  t,
  onError,
  onSuccess,
}: {
  readonly checkoutSessionId: string;
  readonly codes: readonly CheckoutDiscountCodeSummary[];
  readonly t: Dictionary;
  /** A failure other than a rejected code: shown in the page's error banner. */
  readonly onError: (reason: DiscountCodeFailure) => void;
  /** A code was applied or removed: the page clears its (now stale) banner or notice. */
  readonly onSuccess: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [rejection, setRejection] = useState<string | null>(null);
  // Separate, so "Applying…" never shows while a chip is being removed.
  const [isApplying, startApply] = useTransition();
  const [isRemoving, startRemove] = useTransition();
  const isPending = isApplying || isRemoving;
  const copy = t.checkout.discount;

  function onApply(): void {
    const trimmed = code.trim();
    if (trimmed === "" || isPending) return;
    startApply(async () => {
      const result = await applyDiscountCode(checkoutSessionId, trimmed);
      if (result.ok) {
        setCode("");
        setRejection(null);
        onSuccess();
      } else if (result.reason === "rejected") {
        setRejection(result.rejection);
      } else {
        onError(result.reason);
      }
    });
  }

  function onRemove(removed: string): void {
    startRemove(async () => {
      const result = await removeDiscountCode(checkoutSessionId, removed);
      if (result.ok) {
        onSuccess();
      } else {
        // `CheckoutActionResult` also names order-time reasons that a removal never returns.
        onError(
          result.reason === "ownership" ||
            result.reason === "validation" ||
            result.reason === "unavailable"
            ? result.reason
            : "network",
        );
      }
    });
  }

  const inputId = `${id}-code`;
  const messageId = `${id}-message`;

  return (
    <div className="flex flex-col gap-2">
      {/* Not a <form>: the page has exactly one, the checkout itself, and this sits beside it. */}
      <div className="flex flex-col gap-1">
        <Label htmlFor={inputId} className="sr-only">
          {copy.label}
        </Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={code}
            placeholder={copy.placeholder}
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={64}
            // `auto`, not `ltr`: the Arabic placeholder keeps its direction; a typed code reads LTR.
            dir="auto"
            aria-invalid={rejection !== null ? "true" : undefined}
            aria-describedby={rejection !== null ? messageId : undefined}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onApply();
              }
            }}
            onChange={(event) => {
              setCode(event.target.value);
              setRejection(null);
            }}
          />
          <Button
            type="button"
            onClick={onApply}
            variant="outline"
            disabled={code.trim() === "" || isPending}
            loading={isApplying}
          >
            {isApplying ? copy.applying : copy.apply}
          </Button>
        </div>
        {rejection !== null && (
          <p id={messageId} role="alert" className="text-destructive text-xs">
            {discountReasonMessage(rejection, t)}
          </p>
        )}
      </div>

      {codes.length > 0 && (
        <ul aria-label={copy.codesLabel} className="flex flex-wrap gap-2">
          {codes.map((entry) => (
            <li
              key={entry.code}
              className={
                entry.applicable
                  ? "bg-muted flex flex-col gap-0.5 rounded-md px-2 py-1 text-xs font-medium"
                  : "bg-muted/50 text-muted-foreground flex flex-col gap-0.5 rounded-md px-2 py-1 text-xs"
              }
            >
              <span className="flex items-center gap-1.5">
                <TagIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span dir="ltr">{entry.code}</span>
                <button
                  type="button"
                  aria-label={copy.removeLabel.replace("{code}", entry.code)}
                  disabled={isPending}
                  onClick={() => onRemove(entry.code)}
                  className="hover:text-foreground -me-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm p-1 disabled:opacity-50"
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                </button>
              </span>
              {!entry.applicable && (
                <span>
                  {copy.notApplicable.replace("{reason}", discountReasonMessage(entry.reason, t))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
