"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import { issueRecoveryLinkAction } from "@/app/abandoned-checkouts/actions";
import { fillTemplate, toWhatsAppDigits, whatsAppUrl } from "@/lib/whatsapp";
import type { Dictionary } from "@/messages/en";

/** How long "Copied" stays on the button. */
const COPIED_RESET_MS = 3000;

/** True only when the browser really put the text on the clipboard. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shopify's Recovery card (spec §3.7). Every press makes a NEW link through the server action (a link
 * cannot be shown twice — only its hash is stored). The link is always shown in a read-only field,
 * so a refused clipboard (Safari after an await, no permission, insecure context) still leaves the
 * merchant something to copy; "Copied" appears only after a real copy. WhatsApp opens `wa.me` with a
 * message the merchant can edit first.
 */
export function RecoveryCard({
  checkoutId,
  customerName,
  phone,
  country,
  canRecover,
  t,
}: {
  readonly checkoutId: string;
  readonly customerName: string | null;
  readonly phone: string | null;
  readonly country: string | null;
  readonly canRecover: boolean;
  readonly t: Dictionary;
}) {
  const r = t.abandonedCheckouts.recovery;
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [message, setMessage] = useState("");

  const linkField = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectLink, setSelectLink] = useState(false);

  const clearResetTimer = () => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = null;
  };
  useEffect(() => clearResetTimer, []);

  // A refused clipboard leaves the link to the merchant: focus and select it, ready for Ctrl+C.
  useEffect(() => {
    if (selectLink && link !== null) {
      linkField.current?.focus();
      linkField.current?.select();
      setSelectLink(false);
    }
  }, [selectLink, link]);

  const issue = async () => {
    try {
      const result = await issueRecoveryLinkAction(checkoutId);
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      setError(null);
      setLink(result.url);
      return result;
    } catch {
      // network drop, deployment skew: say so here rather than taking the page down
      setError(r.error);
      return null;
    }
  };

  /** One press at a time: a second press (either button) while a link is being made is ignored. */
  const press = (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        await work();
      } finally {
        busy.current = false;
      }
    });
  };

  const copy = () =>
    press(async () => {
      clearResetTimer();
      setCopied(false);
      const issued = await issue();
      if (issued === null) return;
      const done = await copyText(issued.url);
      setCopied(done);
      if (done) {
        resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
      } else {
        setSelectLink(true);
      }
    });

  const share = () =>
    press(async () => {
      clearResetTimer();
      setCopied(false);
      const issued = await issue();
      if (issued === null) return;
      const template = customerName === null ? r.whatsappMessageNoName : r.whatsappMessage;
      setMessage(
        fillTemplate(template, {
          name: customerName ?? "",
          shop: issued.shopName,
          url: issued.url,
        }),
      );
      setShareOpen(true);
    });

  const openWhatsApp = () => {
    window.open(
      whatsAppUrl(toWhatsAppDigits(phone, country), message),
      "_blank",
      "noopener,noreferrer",
    );
    setShareOpen(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{r.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canRecover && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copy} disabled={pending}>
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? r.copied : r.copy}
            </Button>
            <Button type="button" onClick={share} disabled={pending}>
              <MessageCircleIcon aria-hidden="true" />
              {r.whatsapp}
            </Button>
          </div>
        )}
        {pending && <p className="text-muted-foreground text-sm">{r.issuing}</p>}
        {link !== null && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-link`}>{r.linkLabel}</Label>
            <Input
              id={`${id}-link`}
              ref={linkField}
              readOnly
              value={link}
              dir="ltr"
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className="text-muted-foreground text-xs">{r.expires}</p>
          </div>
        )}
        <span role="status" className="sr-only">
          {copied ? r.copied : ""}
        </span>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <p className="text-muted-foreground text-sm">{r.comingSoon}</p>
      </CardContent>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{r.dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-message`}>{r.messageLabel}</Label>
            <textarea
              id={`${id}-message`}
              rows={5}
              dir="auto"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="border-input bg-card focus-visible:ring-ring min-h-28 w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShareOpen(false)}>
              {r.cancel}
            </Button>
            <Button type="button" onClick={openWhatsApp} disabled={message.trim().length === 0}>
              {r.openWhatsApp}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
