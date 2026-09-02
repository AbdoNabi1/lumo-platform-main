"use client";

import * as React from "react";
import { MenuIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";

/**
 * Mobile navigation drawer. Below `md` the sidebar is not on screen at all, so the same
 * navigation is rendered here inside a dialog — focus is trapped while it is open and
 * returns to the trigger on close.
 *
 * `children` is the server-rendered `<SidebarNav>`: one navigation definition, two
 * presentations.
 */
export function MobileNav({
  children,
  footer,
  openLabel,
  title,
  description,
}: {
  readonly children: React.ReactNode;
  /** Rendered below the navigation and outside the auto-close region — controls, not links. */
  readonly footer?: React.ReactNode;
  readonly openLabel: string;
  readonly title: string;
  readonly description: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={openLabel} className="md:hidden">
          <MenuIcon aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent position="inline-start" className="gap-0 p-0 pt-4">
        <DialogTitle className="px-6 pb-4 text-lg">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {/*
          No click-to-close wrapper: the nav items are real links, so following one replaces
          the page and takes the drawer with it. A div-level click handler would only add a
          dismissal path that the keyboard cannot reach — Escape and the close button already
          cover that, for every input method.
        */}
        <div className="flex flex-1 flex-col">{children}</div>
        {footer !== undefined && <div className="border-border border-t px-6 py-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
