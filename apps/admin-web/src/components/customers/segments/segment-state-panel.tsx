import type { ReactNode } from "react";
import { Card, CardContent } from "@platform/ui";

/** A centred icon and one sentence — the empty / error / unavailable state of a segments screen. */
export function SegmentStatePanel({
  icon,
  message,
  children,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
        {children}
      </CardContent>
    </Card>
  );
}
