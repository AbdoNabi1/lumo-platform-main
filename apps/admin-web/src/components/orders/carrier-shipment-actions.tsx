"use client";

import { useRef, useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";
import {
  cancelCarrierShipmentAction,
  retryCarrierShipmentAction,
  shipWithCarrierAction,
} from "@/app/orders/carrier-actions";
import type { Dictionary } from "@/messages/en";

function ErrorLine({ message }: { readonly message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

/** The primary "Ship with {carrier}" button. */
export function ShipButton({
  orderId,
  carrierKey,
  carrierName,
  t,
}: {
  readonly orderId: string;
  readonly carrierKey: string;
  readonly carrierName: string;
  readonly t: Dictionary;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function ship(): void {
    setError(null);
    start(async () => {
      const result = await shipWithCarrierAction(orderId, carrierKey);
      if (result.status === "error") setError(result.message);
    });
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" onClick={ship} disabled={pending} loading={pending}>
        {pending
          ? t.carrierShipping.shipping
          : t.carrierShipping.shipWith.replace("{carrier}", carrierName)}
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}

/** "I checked Bosta — ship again": retries the stuck shipment, then ships. */
export function ShipAgainButton({
  orderId,
  shipmentId,
  carrierKey,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly carrierKey: string;
  readonly t: Dictionary;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function shipAgain(): void {
    setError(null);
    start(async () => {
      const result = await retryCarrierShipmentAction(orderId, shipmentId, carrierKey);
      if (result.status === "error") setError(result.message);
    });
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" onClick={shipAgain} disabled={pending} loading={pending}>
        {pending ? t.carrierShipping.shipping : t.carrierShipping.shipAgain}
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}

/** "Cancel shipment" behind an accessible confirmation (focus on the dismiss button, Escape, focus restore). */
export function CancelShipmentButton({
  orderId,
  shipmentId,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly t: Dictionary;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  function cancel(): void {
    start(async () => {
      const result = await cancelCarrierShipmentAction(orderId, shipmentId);
      setError(result.status === "error" ? result.message : null);
      setOpen(false);
    });
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline">
            {t.carrierShipping.cancelShipment}
          </Button>
        </DialogTrigger>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dismissRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.carrierShipping.cancelShipment}</DialogTitle>
            <DialogDescription>{t.carrierShipping.confirmCancel}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button ref={dismissRef} type="button" variant="outline" onClick={() => setOpen(false)}>
              {t.carrierSettings.cancel}
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={cancel}>
              {pending ? t.carrierShipping.cancelling : t.carrierShipping.cancelShipment}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ErrorLine message={error} />
    </div>
  );
}
