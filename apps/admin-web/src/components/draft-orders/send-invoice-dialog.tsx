"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { draftWhatsAppTarget, invoiceMessage, type DraftForm } from "@/lib/orders/draft-orders";
import { isolateName } from "@/lib/orders/order-timeline";
import { toWhatsAppDigits, whatsAppUrl } from "@/lib/whatsapp";
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
 * Send invoice (spec §4.9), Part 3's Recovery card pattern in a dialog. The link was minted by the
 * press that opened this dialog and lives only in this dialog's props — never stored, logged or put
 * in a URL of ours; closing it forgets it (the next Send invoice mints a new one). The link is always
 * in a read-only field, so a refused clipboard still leaves something to copy; "Copied" shows only
 * after a real copy. WhatsApp opens `wa.me` with a message the merchant can edit first.
 */
export function SendInvoiceDialog({
  url,
  shopName,
  draftNumber,
  total,
  currency,
  form,
  onClose,
  t,
  locale,
}: {
  readonly url: string;
  readonly shopName: string;
  readonly draftNumber: string;
  readonly total: number;
  readonly currency: string;
  readonly form: Pick<DraftForm, "phone" | "shippingAddress" | "customer">;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const i = t.draftOrders.editor.invoice;
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectLink, setSelectLink] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );
  // A refused clipboard leaves the link to the merchant: focus and select it, ready for Ctrl+C.
  useEffect(() => {
    if (!selectLink) return;
    field.current?.focus();
    field.current?.select();
    setSelectLink(false);
  }, [selectLink]);

  const copy = async () => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    const done = await copyText(url);
    setCopied(done);
    if (done) resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    else setSelectLink(true);
  };

  const share = () => {
    const name = form.shippingAddress?.name.trim() || form.customer?.name?.trim() || "";
    setMessage(
      invoiceMessage(name === "" ? i.messageNoName : i.message, {
        name,
        // "#D3" keeps its own direction inside an Arabic sentence (FSI … PDI; WhatsApp honours it).
        draft: isolateName(`#${draftNumber}`),
        shop: shopName,
        total: formatCurrency(locale, total, currency),
        url,
      }),
    );
  };

  const openWhatsApp = () => {
    if (message === null) return;
    const target = draftWhatsAppTarget(form);
    window.open(
      whatsAppUrl(toWhatsAppDigits(target.phone, target.country), message),
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{i.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-link`}>{i.linkLabel}</Label>
          <Input
            id={`${id}-link`}
            ref={field}
            readOnly
            value={url}
            dir="ltr"
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-muted-foreground text-xs">{i.expires}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? i.copied : i.copy}
          </Button>
          <Button type="button" onClick={share}>
            <MessageCircleIcon aria-hidden="true" />
            {i.whatsapp}
          </Button>
        </div>
        <span role="status" className="sr-only">
          {copied ? i.copied : ""}
        </span>
        {message !== null && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-message`}>{i.messageLabel}</Label>
            <textarea
              id={`${id}-message`}
              rows={5}
              dir="auto"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="border-input bg-card focus-visible:ring-ring min-h-28 w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
            />
            <div className="flex justify-end">
              <Button type="button" onClick={openWhatsApp} disabled={message.trim().length === 0}>
                {i.openWhatsApp}
              </Button>
            </div>
          </div>
        )}
        <p className="text-muted-foreground text-sm" aria-disabled="true">
          {i.email}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {i.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
