import { LogOutIcon } from "lucide-react";
import { Button, cn } from "@platform/ui";

/**
 * The one sign-out control. Deliberately a plain `<a href="/logout">`, never a `next/link`
 * `<Link>`: Link prefetches its target, and `/logout` is a GET route that clears the session —
 * a prefetch would sign the user out without them clicking anything.
 *
 * The icon is mirrored under RTL (`rtl:-scale-x-100`) so the arrow still points out of the door.
 */
export function SignOutLink({
  label,
  className,
  hideLabel = "",
}: {
  readonly label: string;
  readonly className?: string;
  /** Classes applied to the text only, e.g. `max-lg:sr-only` for the icon-rail sidebar. */
  readonly hideLabel?: string;
}) {
  return (
    <Button asChild variant="ghost" size="md" className={cn("justify-start", className)}>
      <a href="/logout">
        <LogOutIcon aria-hidden="true" className="rtl:-scale-x-100" />
        <span className={hideLabel}>{label}</span>
      </a>
    </Button>
  );
}
