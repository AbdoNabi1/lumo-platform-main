"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";
import { listLibraryImagesAction } from "@/app/online-store/themes/actions";
import type { LibraryImageDto } from "@/lib/api/media";
import type { OnlineStoreImageDto } from "@/lib/api/online-store";
import { settleAction } from "@/lib/online-store/settle-action";
import type { Dictionary } from "@/messages/en";

/**
 * The shop's image library (Ruling 19) as a dialog (portalled by `@platform/ui`, so a
 * `backdrop-blur` sidebar can never clip it). Pages of 24 load through `settleAction`: a thrown
 * action is the localised error with a Try again button, never a stuck spinner, and a Next
 * redirect still propagates (the load runs inside a transition, which hands a rethrown error to the
 * route's error boundary). The empty state shows only when the API says there is no next page (a
 * page that held no usable image is not the end of the library, F17).
 */
export function MediaLibraryDialog({
  t,
  open,
  onOpenChange,
  onPick,
}: {
  readonly t: Dictionary;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (image: OnlineStoreImageDto & { id: string }) => void;
}) {
  const c = t.onlineStoreSections.image;
  const [items, setItems] = useState<readonly LibraryImageDto[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const generation = useRef(0);
  /** The cursor the next read continues from: null for the first page. */
  const after = useRef<string | null>(null);

  const load = useCallback(
    (from: string | null) => {
      const mine = generation.current;
      setFailed(false);
      start(async () => {
        const result = await settleAction(() => listLibraryImagesAction(from), {
          status: "error",
        } as const);
        if (mine !== generation.current) return; // closed or reopened meanwhile
        if (result.status === "ok") {
          setItems((before) => (from === null ? result.items : [...before, ...result.items]));
          setHasNextPage(result.hasNextPage);
          setLoaded(true);
          after.current = result.endCursor;
        } else {
          setFailed(true);
          after.current = from;
        }
      });
    },
    [start],
  );

  // Each opening starts from the first page, so a new upload shows.
  useEffect(() => {
    if (!open) return;
    generation.current += 1;
    setItems([]);
    setHasNextPage(false);
    setLoaded(false);
    after.current = null;
    load(null);
    return () => {
      generation.current += 1;
    };
  }, [open, load]);

  const labelOf = (item: LibraryImageDto) =>
    item.name !== "" ? item.name : (item.image.alt ?? item.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <bdi>{c.libraryTitle}</bdi>
          </DialogTitle>
        </DialogHeader>
        {items.length === 0 ? null : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-label={labelOf(item)}
                  className="border-border hover:border-primary focus-visible:outline-ring block w-full overflow-hidden rounded-lg border"
                  onClick={() => {
                    onPick({ ...item.image, id: item.id });
                    onOpenChange(false);
                  }}
                >
                  <Image
                    src={item.image.url}
                    alt=""
                    width={item.image.width ?? 96}
                    height={item.image.height ?? 96}
                    unoptimized
                    className="aspect-square w-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {loaded && items.length === 0 && !hasNextPage && !failed ? (
          <p className="text-muted-foreground text-sm">{c.libraryEmpty}</p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-destructive text-sm">
            {c.libraryError}
          </p>
        ) : null}
        <DialogFooter>
          {failed ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              loading={pending}
              onClick={() => load(after.current)}
            >
              {c.retry}
            </Button>
          ) : hasNextPage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              loading={pending}
              onClick={() => load(after.current)}
            >
              {c.loadMore}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
