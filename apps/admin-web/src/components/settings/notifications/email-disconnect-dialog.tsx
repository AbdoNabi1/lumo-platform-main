"use client";

import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";
import { disconnectEmailConnectionAction } from "@/app/settings/notifications/actions";
import type {
  EmailConnectionActionResult,
  EmailConnectionSnapshot,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";

/** The message a refused disconnect shows, in the page's language. */
function refusal(result: EmailConnectionActionResult, t: Dictionary): string {
  const copy = t.notificationSettings;
  switch (result.status) {
    case "unavailable":
      return copy.email.unavailable;
    case "rate_limited":
      return copy.email.rateLimited;
    case "conflict":
    case "error":
      return result.message;
    case "success":
      return t.formErrors.unexpected;
  }
}

/**
 * Disconnect the store's email account, behind a real confirm `Dialog`: a title, a description
 * that says what is lost, initial focus on Cancel (never on the destructive button), Escape closes
 * (even while the request is running: the request still finishes and the card hears about it) and
 * focus goes back to the trigger. A refusal is shown inside the dialog, which stays open; if the
 * dialog was closed meanwhile, the card shows it instead.
 */
export function EmailDisconnectDialog({
  disabled,
  onDisconnected,
  onRefused,
  t,
}: {
  readonly disabled: boolean;
  readonly onDisconnected: (snapshot: EmailConnectionSnapshot) => void;
  /** A refusal that arrived after the dialog was closed. */
  readonly onRefused: (message: string) => void;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings.email;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);

  const changeOpen = (next: boolean) => {
    openRef.current = next;
    if (next) setError(null);
    setOpen(next);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    let result: EmailConnectionActionResult;
    try {
      result = await disconnectEmailConnectionAction();
    } catch {
      result = { status: "error", message: t.formErrors.unexpected, fieldErrors: {} };
    }
    setPending(false);
    if (result.status === "success") {
      changeOpen(false);
      onDisconnected(result.snapshot);
      return;
    }
    const message = refusal(result, t);
    if (openRef.current) setError(message);
    else onRefused(message);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          {copy.disconnect}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.disconnectTitle}</DialogTitle>
          <DialogDescription>{copy.disconnectBody}</DialogDescription>
        </DialogHeader>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            ref={cancel}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => changeOpen(false)}
          >
            {copy.disconnectCancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={pending}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? copy.disconnecting : copy.disconnectConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
