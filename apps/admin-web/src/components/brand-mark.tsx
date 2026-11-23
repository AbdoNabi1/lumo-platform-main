import { cn } from "@platform/ui";

/**
 * The Morbeh mark: the Nusuj 2×2 bento (two circles in the secondary brand tone, two pills in
 * the primary). Locked; see docs/ui/BRAND_LOCK.md. Drawn rather than imported so the colours come
 * from the token layer (`fill-brand-secondary`, `fill-primary`) and follow light/dark.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-7", className)}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="17" cy="19" r="9" className="fill-brand-secondary" />
      <rect x="30" y="10" width="26" height="18" rx="9" className="fill-primary" />
      <rect x="8" y="36" width="26" height="18" rx="9" className="fill-primary" />
      <circle cx="47" cy="45" r="9" className="fill-brand-secondary" />
    </svg>
  );
}
