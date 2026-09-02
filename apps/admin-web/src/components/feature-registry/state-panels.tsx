import type { ReactNode } from "react";
import { Card, CardContent } from "@platform/ui";

/** A full-card empty/unauthorized/error state — same shape `orders/page.tsx`'s `StatePanel` uses. */
export function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}

/** The same state, without its own `Card` wrapper — for use inside a card that already has a header (`ResolvePanel`, `ValidationSummary`). */
export function InlineState({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-center text-base">
      {icon}
      <p role="note">{message}</p>
    </div>
  );
}
