"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@platform/ui";
import { advancePageAction } from "@/app/pages/actions";
import type { LiveSaveState } from "@/lib/api/mutation";
import { settleAction } from "@/lib/online-store/settle-action";
import { pageAdvanceableStatusesFrom } from "@/lib/pages-lifecycle";
import type { Dictionary } from "@/messages/en";
import { SaveStatus } from "@/components/online-store/save-status";

/**
 * The page's visibility (Ruling 15), gated by the hand-copied `PAGE_LIFECYCLE_TRANSITIONS`:
 * **Publish** a draft, **Hide** a published page (back to draft), **Archive** either (asked first:
 * it cannot be undone). Each change reaches the storefront. The server refresh swaps the buttons,
 * so keyboard focus moves to this group instead of falling back to the page. Nothing for a viewer.
 */
export function PageLifecycleActions({
  t,
  pageId,
  status,
  canEdit,
}: {
  readonly t: Dictionary;
  readonly pageId: string;
  readonly status: string;
  readonly canEdit: boolean;
}) {
  const e = t.pageEditor;
  const headingId = useId();
  const group = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [state, setState] = useState<LiveSaveState>({ status: "idle" });
  const targets = canEdit ? pageAdvanceableStatusesFrom(status) : [];

  // The buttons for the new status replaced the one that had focus: keep focus in this group.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    group.current?.focus();
  }, [status]);

  if (targets.length === 0) return null;

  const labelOf = (target: string) =>
    target === "published" ? e.publish : target === "draft" ? e.hide : e.archive;

  const advance = async (target: string) => {
    if (target === "archived" && !window.confirm(e.archiveConfirm)) return;
    setPending(target);
    setState({ status: "idle" });
    try {
      const result = await settleAction(() => advancePageAction(pageId, target), {
        status: "error",
        message: t.formErrors.unexpected,
        fieldErrors: {},
      });
      setState(result);
      if (result.status === "success") {
        refocus.current = true;
        group.current?.focus();
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      ref={group}
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="flex flex-col gap-3 outline-none"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {t.pageLifecycle.title}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((target) => (
          <Button
            key={target}
            type="button"
            size="sm"
            variant={target === "archived" ? "outline" : "primary"}
            loading={pending === target}
            disabled={pending !== null}
            onClick={() => void advance(target)}
          >
            {labelOf(target)}
          </Button>
        ))}
      </div>
      <SaveStatus t={t} state={state} />
    </div>
  );
}
