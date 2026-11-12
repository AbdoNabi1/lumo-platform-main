"use client";

import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import type { ExportScope } from "@/lib/orders/orders-export";
import type { Dictionary } from "@/messages/en";

/** What the list is showing — carried into the export so "Current page"/"matching" mean the same rows. */
export interface OrdersExportContext {
  readonly view: string;
  readonly q?: string;
  readonly status?: string;
  readonly after?: string;
  /** Order operations Part 2: the list's "Tagged with" filter. */
  readonly tags?: readonly string[];
  readonly hasFilters: boolean;
}

/**
 * Shopify's "Export orders" dialog (spec §1.5). A native GET form to the `/orders/export` route handler:
 * the browser downloads the file and the page stays. Format: one, "CSV for Excel".
 */
export function OrdersExportDialog({
  open,
  onOpenChange,
  context,
  selectedIds,
  defaultScope,
  t,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly context: OrdersExportContext;
  readonly selectedIds: readonly string[];
  readonly defaultScope?: ExportScope;
  readonly t: Dictionary;
}) {
  const e = t.ordersExport;
  const [scope, setScope] = useState<ExportScope>(
    defaultScope ?? (selectedIds.length > 0 ? "selected" : "current_page"),
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const canSubmit = scope !== "dates" || (from.length > 0 && to.length > 0 && from <= to);
  const options: readonly { value: ExportScope; label: string; disabled: boolean }[] = [
    { value: "current_page", label: e.currentPage, disabled: false },
    { value: "all", label: e.all, disabled: false },
    {
      value: "selected",
      label: e.selected.replace("{count}", String(selectedIds.length)),
      disabled: selectedIds.length === 0,
    },
    ...(context.hasFilters
      ? [{ value: "matching" as const, label: e.matching, disabled: false }]
      : []),
    { value: "dates", label: e.dates, disabled: false },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{e.title}</DialogTitle>
          <DialogDescription>{e.cap}</DialogDescription>
        </DialogHeader>
        <form
          method="get"
          action="/orders/export"
          // Closing in the same tick would unmount the form before the browser starts the download.
          onSubmit={() => setTimeout(() => onOpenChange(false), 0)}
          className="flex flex-col gap-4"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{e.scopeLegend}</legend>
            {options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="scope"
                  value={option.value}
                  checked={scope === option.value}
                  disabled={option.disabled}
                  onChange={() => setScope(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          {scope === "dates" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="orders-export-from">{e.from}</Label>
                <Input
                  id="orders-export-from"
                  type="date"
                  name="from"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="orders-export-to">{e.to}</Label>
                <Input
                  id="orders-export-to"
                  type="date"
                  name="to"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  required
                />
              </div>
            </div>
          )}
          <p className="text-sm">
            <span className="text-muted-foreground">{e.formatLabel}</span> {e.format}
          </p>
          <input type="hidden" name="view" value={context.view} />
          {context.q !== undefined && <input type="hidden" name="q" value={context.q} />}
          {context.status !== undefined && (
            <input type="hidden" name="status" value={context.status} />
          )}
          {context.tags !== undefined && context.tags.length > 0 && (
            <input type="hidden" name="tag" value={context.tags.join(",")} />
          )}
          {context.after !== undefined && (
            <input type="hidden" name="after" value={context.after} />
          )}
          {selectedIds.length > 0 && (
            <input type="hidden" name="ids" value={selectedIds.join(",")} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {e.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {e.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The page header's secondary "Export" button. */
export function OrdersExportButton({
  context,
  t,
}: {
  readonly context: OrdersExportContext;
  readonly t: Dictionary;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <DownloadIcon aria-hidden="true" />
        {t.ordersPage.export}
      </Button>
      {open && (
        <OrdersExportDialog open onOpenChange={setOpen} context={context} selectedIds={[]} t={t} />
      )}
    </>
  );
}
