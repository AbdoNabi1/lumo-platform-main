import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { cn } from "@platform/ui";

/**
 * Plan 2C-3 — a 40px product picture for lists and order lines, or a placeholder tile when there is
 * none (a product without pictures, one deleted since the order, or an older API that sends no url).
 * `unoptimized` serves the stored file as it is (no image-optimizer cost, no remote-host config), and
 * the fixed width and height keep the row from shifting while it loads.
 */
export function ProductThumb({
  url,
  alt,
  className,
}: {
  readonly url: string | null | undefined;
  readonly alt: string;
  readonly className?: string;
}) {
  if (url === null || url === undefined) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg",
          className,
        )}
      >
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      width={40}
      height={40}
      unoptimized
      loading="lazy"
      className={cn("bg-muted size-10 shrink-0 rounded-lg object-cover", className)}
    />
  );
}
