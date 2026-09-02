"use client";

import { useState, useTransition } from "react";
import { Button, Label } from "@platform/ui";
import { submitProductReview } from "@/app/products/[slug]/actions";
import type { Dictionary } from "@/messages/en";

const RATINGS = [5, 4, 3, 2, 1] as const;

/**
 * Product review submission (T5.18-write). **Rendered only when a real server-side session check
 * succeeds** — the caller (the product detail page) decides this, exactly the same discipline
 * `AddToWishlistButton` uses: an anonymous shopper is shown a sign-in link instead of a form that
 * would fail on submit, never a disabled or misleading one.
 *
 * A submitted review does not appear in the published list above it — it starts `"pending"`
 * moderation, same as every review this codebase creates — so success is shown as an honest
 * "submitted, awaiting review" message, not a fabricated live review.
 */
export function WriteReviewForm({
  slug,
  productRef,
  t,
}: {
  readonly slug: string;
  readonly productRef: string;
  readonly t: Dictionary;
}) {
  const [isPending, startTransition] = useTransition();
  const [rating, setRating] = useState(5);
  const [bodyText, setBodyText] = useState("");
  const [result, setResult] = useState<
    "idle" | "ok" | "duplicate" | "validation" | "network"
  >("idle");

  const copy = t.product.reviewForm;

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    startTransition(async () => {
      const response = await submitProductReview(slug, productRef, rating, bodyText);
      if (response.ok) {
        setResult("ok");
        setBodyText("");
        return;
      }
      // `"signed-out"` can only happen if the session expired between render and submit — the
      // caller already withholds this form for a genuinely signed-out shopper.
      setResult(response.reason === "signed-out" ? "network" : response.reason);
    });
  }

  if (result === "ok") {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {copy.success}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h3 className="text-sm font-semibold">{copy.title}</h3>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-rating">{copy.ratingLabel}</Label>
        <select
          id="review-rating"
          name="rating"
          value={rating}
          onChange={(event) => setRating(Number(event.target.value))}
          className="border-input bg-card text-foreground h-9 w-24 rounded-xl border px-3 text-base"
        >
          {RATINGS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-body">{copy.bodyLabel}</Label>
        <textarea
          id="review-body"
          name="bodyText"
          required
          minLength={1}
          rows={4}
          value={bodyText}
          onChange={(event) => setBodyText(event.target.value)}
          className="border-input bg-card text-foreground w-full rounded-xl border px-3.5 py-2 text-base"
        />
      </div>

      {(result === "duplicate" || result === "validation" || result === "network") && (
        <p className="text-destructive text-sm" role="alert">
          {copy.errors[result]}
        </p>
      )}

      <Button
        type="submit"
        disabled={isPending || bodyText.trim().length === 0}
        loading={isPending}
        className="self-start"
      >
        {isPending ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
