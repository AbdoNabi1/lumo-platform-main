"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { PackageIcon } from "lucide-react";
import { cn } from "@platform/ui";
import type { ProductImageSummary } from "@/lib/runtime-api";
import type { Dictionary } from "@/messages/en";
import { useProductSelection } from "./product-selection";

/**
 * Plan 2C-3 — the product page's pictures, like Shopify's: one large picture in a square box
 * (`object-contain` on a muted ground, so nothing is cropped) and the thumbnails below in a row that
 * scrolls sideways, the selected one ringed. Without JavaScript the first picture still shows — this is
 * server-rendered like any Client Component. Picking a variant that has its own picture switches the
 * large one to it (see {@link ProductSelectionProvider}); a variant without one leaves the current
 * picture alone. The first picture is `priority` (it is what the page is about); thumbnails are lazy.
 */
export function ProductGallery({
  media,
  productName,
  t,
}: {
  readonly media: readonly ProductImageSummary[];
  readonly productName: string;
  readonly t: Dictionary;
}) {
  const { variantImageId } = useProductSelection();
  const [selectedId, setSelectedId] = useState<string | null>(media[0]?.id ?? null);

  useEffect(() => {
    if (variantImageId !== null && media.some((image) => image.id === variantImageId)) {
      setSelectedId(variantImageId);
    }
  }, [variantImageId, media]);

  const selected = media.find((image) => image.id === selectedId) ?? media[0];
  const describe = (image: ProductImageSummary): string => image.alt ?? productName;

  if (selected === undefined) {
    return (
      <div
        data-testid="gallery-main"
        role="img"
        aria-label={t.product.gallery.noImage}
        className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center rounded-lg"
      >
        <PackageIcon aria-hidden="true" className="size-10" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="gallery-main"
        className="bg-muted relative aspect-square w-full overflow-hidden rounded-lg"
      >
        <Image
          key={selected.id}
          src={selected.url}
          alt={describe(selected)}
          fill
          sizes="(min-width: 768px) 28rem, 100vw"
          unoptimized
          {...(selected.id === media[0]?.id ? { priority: true } : { loading: "eager" as const })}
          className="object-contain"
        />
      </div>

      {media.length > 1 && (
        <ul
          data-testid="gallery-thumbs"
          aria-label={t.product.gallery.label}
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {media.map((image, index) => {
            const current = image.id === selected.id;
            return (
              <li key={image.id} className="shrink-0">
                <button
                  type="button"
                  data-testid={`gallery-thumb-${image.id}`}
                  aria-label={t.product.gallery.showImage
                    .replace("{n}", String(index + 1))
                    .replace("{total}", String(media.length))}
                  aria-current={current ? "true" : undefined}
                  onClick={() => setSelectedId(image.id)}
                  className={cn(
                    "bg-muted relative block size-16 overflow-hidden rounded-md",
                    current ? "ring-primary ring-2" : "ring-border ring-1",
                  )}
                >
                  <Image
                    src={image.url}
                    alt={describe(image)}
                    fill
                    sizes="64px"
                    unoptimized
                    loading="lazy"
                    className="object-cover"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
