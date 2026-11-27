"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";
import type { Dictionary } from "@/messages/en";

export interface BulkShipFailure {
  readonly orderId: string;
  readonly orderNumber?: string;
  readonly message: string;
}

/** The result of a bulk ship: the counts and each failure's localised reason. */
export function BulkShipResultsDialog({
  open,
  onOpenChange,
  shipped,
  failed,
  t,
  onCloseAutoFocus,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly shipped: number;
  readonly failed: readonly BulkShipFailure[];
  readonly t: Dictionary;
  readonly onCloseAutoFocus?: (event: Event) => void;
}) {
  const copy = t.carrierShipping;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{copy.resultsTitle}</DialogTitle>
          <DialogDescription>
            <span>{copy.shippedCount.replace("{count}", String(shipped))}</span>
            {" · "}
            <span>{copy.failedCount.replace("{count}", String(failed.length))}</span>
          </DialogDescription>
        </DialogHeader>
        {failed.length > 0 && (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
            {failed.map((failure) => (
              <li key={failure.orderId} className="flex flex-col">
                <bdi dir="auto" className="font-medium">
                  {failure.orderNumber === undefined ? failure.orderId : `#${failure.orderNumber}`}
                </bdi>
                <span className="text-muted-foreground">{failure.message}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button type="button" onClick={() => onOpenChange(false)}>
            {copy.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
