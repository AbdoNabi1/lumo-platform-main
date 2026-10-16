import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { Dictionary } from "@/messages/en";
import { RetryButton } from "./retry-button";

/**
 * What a card shows when its figures could not be loaded: its title, "Couldn't load" and a Try again
 * button. Never a number, never a fallback: a reader must not mistake a failure for a result. A
 * refusal (the signed-in person may not read these figures) is explained instead, since trying again
 * cannot help.
 */
export function DashboardError({
  title,
  t,
  unauthorized = false,
  unauthorizedMessage,
  as = "h3",
  className,
}: {
  readonly title: string;
  readonly t: Dictionary;
  readonly unauthorized?: boolean;
  readonly unauthorizedMessage?: string;
  readonly as?: "h2" | "h3";
  readonly className?: string;
}) {
  const Icon = unauthorized ? LockIcon : AlertTriangleIcon;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle as={as}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-3 px-4 py-8 text-center text-base sm:px-5">
        <Icon aria-hidden="true" className="size-5" />
        <p role="note">
          {unauthorized ? (unauthorizedMessage ?? t.states.unauthorized) : t.states.loadFailed}
        </p>
        {!unauthorized && <RetryButton label={t.states.tryAgain} />}
      </CardContent>
    </Card>
  );
}
