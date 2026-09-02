import { cn } from "@platform/ui";

/**
 * The Lumo mark — an eight-point light burst. Drawn rather than imported so it inherits
 * `currentColor` and needs no asset pipeline; the brand colour comes from the token layer.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className={cn("text-primary size-6", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6" />
      <path d="M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M18.4 5.6l-3.2 3.2M8.8 15.2l-3.2 3.2" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
