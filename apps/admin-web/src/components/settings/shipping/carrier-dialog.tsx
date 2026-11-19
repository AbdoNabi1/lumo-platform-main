"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@platform/ui";
import {
  saveCarrierAction,
  rotateCarrierSecretAction,
} from "@/app/settings/shipping/carrier-actions";
import { CopyButton } from "@/components/orders/copy-button";
import type { CarrierSettingsEntryDto } from "@/lib/api/carriers";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const initial: FormState = { status: "idle" };
export function CarrierDialogContent({
  carrier,
  t,
  onClose,
}: {
  readonly carrier: CarrierSettingsEntryDto;
  readonly t: Dictionary;
  readonly onClose: () => void;
}) {
  const copy = t.carrierSettings;
  const [state, action, pending] = useActionState(saveCarrierAction, initial);
  const [confirm, setConfirm] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [rotateState, setRotateState] = useState<FormState>(initial);
  const [rotating, startRotation] = useTransition();
  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);
  function rotate() {
    startRotation(async () => {
      setRotateState(await rotateCarrierSecretAction(carrier.key));
      setConfirm(false);
    });
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          <bdi dir="auto">{carrier.key === "bosta" ? copy.carrierBosta : carrier.displayName}</bdi>
        </DialogTitle>
        <DialogDescription>{copy.subtitle}</DialogDescription>
      </DialogHeader>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="carrierKey" value={carrier.key} />
        <label className="grid gap-1">
          {copy.apiKey}
          <Input
            name="apiKey"
            type="password"
            autoComplete="off"
            defaultValue=""
            maxLength={512}
            placeholder={carrier.configured ? copy.apiKeySaved : undefined}
          />
        </label>
        <p className="text-muted-foreground text-sm">{copy.apiKeyHelp}</p>
        <label className="grid gap-1">
          {copy.awbFormat}
          <select name="awbFormat" defaultValue={carrier.config?.awbFormat === "A4" ? "A4" : "A6"}>
            <option value="A6">{copy.a6}</option>
            <option value="A4">{copy.a4}</option>
          </select>
        </label>
        <label className="grid gap-1">
          {copy.awbLanguage}
          <select
            name="awbLanguage"
            defaultValue={carrier.config?.awbLanguage === "en" ? "en" : "ar"}
          >
            <option value="ar">{copy.langAr}</option>
            <option value="en">{copy.langEn}</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="allowToOpenPackage"
            defaultChecked={carrier.config?.allowToOpenPackage === true}
          />
          {copy.allowOpen}
        </label>
        <p className="text-muted-foreground text-sm">{copy.allowOpenHelp}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="enabled" defaultChecked={carrier.enabled} />
          {copy.enabled}
        </label>
        {carrier.webhookUrl !== null && (
          <div>
            <label className="grid gap-1">
              {copy.webhookUrl}
              <Input readOnly value={carrier.webhookUrl} dir="ltr" />
            </label>
            <CopyButton
              text={carrier.webhookUrl}
              label={t.orderPage.copy}
              copiedLabel={t.orderPage.copied}
              ariaLabel={copy.webhookUrl}
            />
            <p className="text-muted-foreground text-sm">{copy.webhookHelp}</p>
          </div>
        )}
        {state.status === "error" && <p role="alert">{state.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {copy.save}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
        </div>
      </form>
      {carrier.configured && (
        <div>
          <Dialog open={confirm} onOpenChange={setConfirm}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline">
                {copy.rotate}
              </Button>
            </DialogTrigger>
            <DialogContent
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                cancelRef.current?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>{copy.rotate}</DialogTitle>
                <DialogDescription>{copy.confirmRotate}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Button
                  ref={cancelRef}
                  type="button"
                  variant="outline"
                  onClick={() => setConfirm(false)}
                >
                  {copy.cancel}
                </Button>
                <Button type="button" disabled={rotating} onClick={rotate}>
                  {copy.rotate}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          {rotateState.status === "error" && <p role="alert">{rotateState.message}</p>}
        </div>
      )}
    </DialogContent>
  );
}
