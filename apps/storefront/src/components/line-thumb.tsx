import type { ReactNode } from "react";
import Image from "next/image";
import { PackageIcon } from "lucide-react";

/**
 * Plan 2C-3 — the picture of a cart or checkout line: a square `size`px thumbnail, or a placeholder
 * when the line has none (a product with no pictures, or one removed since). `children` sit over the
 * picture's corner — the checkout's quantity badge, like Shopify's. `unoptimized` serves the stored
 * file as it is, and the fixed size keeps the line from shifting while it loads.
 */
export function LineThumb({
  url,
  alt,
  size,
  noImageLabel,
  children,
}: {
  readonly url: string | null | undefined;
  readonly alt: string;
  readonly size: number;
  readonly noImageLabel: string;
  readonly children?: ReactNode;
}) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {url === null || url === undefined ? (
        <span
          role="img"
          aria-label={noImageLabel}
          className="bg-muted text-muted-foreground flex size-full items-center justify-center rounded-md"
        >
          <PackageIcon aria-hidden="true" className="size-5" />
        </span>
      ) : (
        <Image
          src={url}
          alt={alt}
          width={size}
          height={size}
          unoptimized
          loading="lazy"
          className="bg-muted size-full rounded-md object-cover"
        />
      )}
      {children}
    </span>
  );
}
