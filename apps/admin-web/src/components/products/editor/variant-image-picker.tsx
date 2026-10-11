"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { cn } from "@platform/ui";
import { setVariantImageAction } from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { ProductImageDto } from "@/lib/api/products";
import type { Dictionary } from "@/messages/en";

const IDLE: FormState = { status: "idle" };

/**
 * Plan 2C-3 — "Image" in the variant dialog: the product's own pictures as small tiles, plus None. A
 * choice is saved at once through the variant-image action, apart from the dialog's Save, and goes back
 * (with the reason) if the server refuses it. A product with no pictures has nothing to pick, so the
 * picker is not drawn.
 */
export function VariantImagePicker({
  productId,
  variantId,
  productName,
  media,
  current,
  t,
}: {
  readonly productId: string;
  readonly variantId: string;
  readonly productName: string;
  readonly media: readonly ProductImageDto[];
  /** The variant's image id, or `null` for none. */
  readonly current: string | null;
  readonly t: Dictionary;
}) {
  const m = t.productMedia;
  const [chosen, setChosen] = useState<string | null>(current);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  if (media.length === 0) return null;

  async function choose(next: string | null): Promise<void> {
    if (next === chosen) return;
    const previous = chosen;
    setChosen(next);
    setError(null);
    const form = new FormData();
    form.append("productId", productId);
    form.append("variantId", variantId);
    form.append("mediaId", next ?? "");
    const state = await setVariantImageAction(IDLE, form);
    if (state.status === "error") {
      setChosen(previous);
      setError(state.message);
    }
  }

  const tile = (selected: boolean) =>
    cn(
      "bg-muted relative size-14 shrink-0 overflow-hidden rounded-md border-2",
      selected ? "border-primary" : "border-transparent hover:border-border",
    );

  return (
    <section className="border-border flex flex-col gap-2 border-t pt-4">
      <h4 id={labelId} className="text-sm font-semibold">
        {m.variantImage}
      </h4>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={chosen === null}
          aria-label={m.variantImageNone}
          onClick={() => void choose(null)}
          className={cn(tile(chosen === null), "text-muted-foreground text-xs")}
        >
          {m.variantImageNone}
        </button>
        {media.map((image) => (
          <button
            key={image.id}
            type="button"
            role="radio"
            aria-checked={chosen === image.id}
            aria-label={image.alt ?? productName}
            onClick={() => void choose(image.id)}
            className={tile(chosen === image.id)}
          >
            <Image
              src={image.url}
              alt=""
              fill
              sizes="56px"
              unoptimized
              loading="lazy"
              className="object-cover"
            />
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{m.variantImageHint}</p>
      {error !== null && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </section>
  );
}
