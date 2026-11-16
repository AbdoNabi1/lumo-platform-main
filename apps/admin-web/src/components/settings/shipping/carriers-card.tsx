"use client";

import { useRef, useState, useTransition } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";
import { disconnectCarrierAction } from "@/app/settings/shipping/carrier-actions";
import type { CarrierSettingsEntryDto } from "@/lib/api/carriers";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { CarrierDialogContent } from "./carrier-dialog";

export function CarriersCard({
  carriers,
  t,
}: {
  readonly carriers: readonly CarrierSettingsEntryDto[];
  readonly t: Dictionary;
}) {
  const copy = t.carrierSettings;
  const [editing, setEditing] = useState<CarrierSettingsEntryDto | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  function disconnect(key: string) {
    startTransition(async () => {
      setState(await disconnectCarrierAction(key));
      setConfirm(null);
    });
  }
  return (
    <section className="rounded-lg border p-5">
      <h2 className="text-lg font-semibold">{copy.title}</h2>
      <p className="text-muted-foreground text-sm">{copy.subtitle}</p>
      {carriers.map((carrier) => (
        <div
          key={carrier.key}
          className="flex flex-wrap items-center justify-between gap-3 border-t py-4"
        >
          <div>
            <p className="font-medium">
              <bdi dir="auto">
                {carrier.key === "bosta" ? copy.carrierBosta : carrier.displayName}
              </bdi>
            </p>
            <Badge variant={carrier.configured ? "success" : "neutral"}>
              {carrier.configured ? copy.connected : copy.notConnected}
            </Badge>
            {!carrier.available && <p>{copy.notAvailable}</p>}
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={!carrier.available} onClick={() => setEditing(carrier)}>
              {carrier.configured ? copy.settings : copy.connect}
            </Button>
            {carrier.configured && (
              <Dialog
                open={confirm === carrier.key}
                onOpenChange={(open) => setConfirm(open ? carrier.key : null)}
              >
                <DialogTrigger asChild>
                  <Button type="button" variant="outline">
                    {copy.disconnect}
                  </Button>
                </DialogTrigger>
                <DialogContent
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    cancelRef.current?.focus();
                  }}
                >
                  <DialogHeader>
                    <DialogTitle>{copy.disconnect}</DialogTitle>
                    <DialogDescription>{copy.confirmDisconnect}</DialogDescription>
                  </DialogHeader>
                  <div className="flex gap-2">
                    <Button
                      ref={cancelRef}
                      type="button"
                      variant="outline"
                      onClick={() => setConfirm(null)}
                    >
                      {copy.cancel}
                    </Button>
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={() => disconnect(carrier.key)}
                    >
                      {copy.disconnect}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      ))}
      {state.status === "error" && <p role="alert">{state.message}</p>}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <CarrierDialogContent carrier={editing} t={t} onClose={() => setEditing(null)} />
        )}
      </Dialog>
    </section>
  );
}
