"use client";

import { useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";
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
import type { Dictionary } from "@/messages/en";

type Scope = "search" | "all";

/**
 * "Export" on the Customers list: a real dialog with "Current search" and "All customers". The form is
 * a native GET to `/customers/export`, so the browser downloads the file and the page stays; the
 * route handler refuses (back to the list with `?exportError=`) rather than send a partial file.
 * "Current search" needs a search to mean anything, so without one it is unavailable and "All
 * customers" is chosen. The trigger stays mounted, so focus returns to it when the dialog closes.
 */
export function CustomersExportDialog({
  search,
  t,
}: {
  readonly search: string;
  readonly t: Dictionary;
}) {
  const x = t.customersExport;
  const hasSearch = search.trim().length > 0;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>(hasSearch ? "search" : "all");
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const options: readonly {
    readonly value: Scope;
    readonly label: string;
    readonly disabled: boolean;
  }[] = [
    { value: "search", label: x.currentSearch, disabled: !hasSearch },
    { value: "all", label: x.all, disabled: false },
  ];
  // A search that was cleared while the dialog was closed must not leave "Current search" chosen.
  const effective: Scope = hasSearch ? scope : "all";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Each opening starts from what the list is showing now.
        if (next) setScope(hasSearch ? "search" : "all");
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button ref={trigger} type="button" variant="outline">
          <DownloadIcon aria-hidden="true" />
          {t.customersPage.export}
        </Button>
      </DialogTrigger>
      <DialogContent
        ref={content}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          content.current?.querySelector<HTMLElement>("input[type=radio]:checked")?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{x.title}</DialogTitle>
          <DialogDescription>{x.description}</DialogDescription>
        </DialogHeader>
        <form
          method="get"
          action="/customers/export"
          // Closing in the same tick would unmount the form before the browser starts the download.
          onSubmit={() => setTimeout(() => setOpen(false), 0)}
          className="flex flex-col gap-4"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{x.scopeLegend}</legend>
            {options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="scope"
                  value={option.value}
                  checked={effective === option.value}
                  disabled={option.disabled}
                  onChange={() => setScope(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          {hasSearch && <input type="hidden" name="q" value={search.trim()} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {x.cancel}
            </Button>
            <Button type="submit">{x.submit}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
