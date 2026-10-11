"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Image from "next/image";
import { ImagePlusIcon, Loader2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@platform/ui";
import {
  attachProductMediaAction,
  detachProductMediaAction,
  reorderProductMediaAction,
  updateMediaAltAction,
  uploadProductImageAction,
} from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { ProductImageDto } from "@/lib/api/products";
import { prepareImage } from "@/lib/media/prepare-image";
import type { Dictionary } from "@/messages/en";

const IDLE: FormState = { status: "idle" };
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
/** How many files are in flight at once, across every drop. */
const CONCURRENCY = 2;

type UploadError = "too_large" | "unsupported" | "failed";

interface Item {
  readonly key: string;
  readonly status: "ready" | "uploading" | "error";
  /** Set once the image is stored. */
  readonly image: ProductImageDto | null;
  /** Kept while uploading or failed, so Retry can send it again. */
  readonly file: File | null;
  readonly error: UploadError | null;
}

interface Batch {
  remaining: number;
  /** Stored images by the order the files were dropped in. */
  readonly images: (ProductImageDto | null)[];
}
interface Job {
  readonly key: string;
  readonly file: File;
  readonly batch: Batch;
  readonly index: number;
}

const readyItem = (image: ProductImageDto): Item => ({
  key: image.id,
  status: "ready",
  image,
  file: null,
  error: null,
});

function formOf(fields: Record<string, string | readonly string[]>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") form.append(name, value);
    else for (const v of value) form.append(name, v);
  }
  return form;
}

/** Moves the item at `from` so it sits where `to` was. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export interface ProductMediaCardProps {
  /** `null` in create mode: uploads wait in hidden inputs until the product exists. */
  readonly productId: string | null;
  /** The fallback description of a picture that has no alt text of its own. */
  readonly productName: string;
  readonly media: readonly ProductImageDto[];
  readonly t: Dictionary;
  /** Create mode: the id of the product form the hidden `mediaAssetId` inputs join. */
  readonly formId?: string;
}

/**
 * Plan 2C-3 — the Shopify "Media" card. It owns its own forms and saves at once (upload, order, alt
 * text, delete), apart from the page's Save. The first picture is the large, featured one. Files are
 * scaled and re-encoded in the browser (`prepareImage`), then uploaded two at a time through a Server
 * Action; a batch is attached to the product in the order the files were dropped. In create mode there
 * is no product to attach to, so the ids ride in hidden inputs and `createProductAction` attaches them.
 */
export function ProductMediaCard({
  productId,
  productName,
  media,
  t,
  formId,
}: ProductMediaCardProps) {
  const m = t.productMedia;
  const [items, setItems] = useState<Item[]>(() => media.map(readyItem));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageDown, setStorageDown] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragKey = useRef<string | null>(null);
  const counter = useRef(0);
  const queue = useRef<Job[]>([]);
  const active = useRef(0);

  // A fresh server state (after an upload batch, a delete…) replaces the stored pictures; pictures
  // still uploading, or failed, stay where they are.
  const mediaKey = JSON.stringify(media.map((image) => [image.id, image.alt]));
  useEffect(() => {
    if (productId === null) return;
    setItems((current) => [
      ...media.map(readyItem),
      ...current.filter((item) => item.status !== "ready"),
    ]);
    // `media` is captured by `mediaKey`.
  }, [mediaKey, productId]);

  const ready = items.filter((item) => item.status === "ready" && item.image !== null);
  const pending = items.filter((item) => item.status !== "ready");

  const patch = useCallback((key: string, next: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...next } : item)));
  }, []);
  const drop = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  // ── uploading ───────────────────────────────────────────────────────────────────────────────
  const finishBatch = useCallback(
    async (batch: Batch) => {
      const stored = batch.images.filter((image): image is ProductImageDto => image !== null);
      if (productId === null || stored.length === 0) return;
      const state = await attachProductMediaAction(
        IDLE,
        formOf({ productId, assetId: stored.map((image) => image.id) }),
      );
      if (state.status === "error") setNotice(m.errorFailed);
    },
    [productId, m.errorFailed],
  );

  const runJob = useCallback(
    async (job: Job) => {
      try {
        const prepared = await prepareImage(job.file);
        if (!prepared.ok) {
          patch(job.key, { status: "error", error: prepared.reason });
          return;
        }
        const result = await uploadProductImageAction(withFile(prepared.file));
        if (result.status === "ok") {
          job.batch.images[job.index] = result.image;
          patch(job.key, {
            key: result.image.id,
            status: "ready",
            image: result.image,
            file: null,
            error: null,
          });
        } else if (result.reason === "unavailable") {
          setStorageDown(true);
          drop(job.key);
        } else {
          patch(job.key, { status: "error", error: result.reason });
        }
      } catch {
        patch(job.key, { status: "error", error: "failed" });
      }
    },
    [patch, drop],
  );

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && queue.current.length > 0) {
      const job = queue.current.shift()!;
      active.current += 1;
      void runJob(job).finally(() => {
        active.current -= 1;
        job.batch.remaining -= 1;
        if (job.batch.remaining === 0) void finishBatch(job.batch);
        pump();
      });
    }
  }, [runJob, finishBatch]);

  const enqueue = useCallback(
    (entries: readonly { key: string; file: File }[]) => {
      const batch: Batch = { remaining: entries.length, images: entries.map(() => null) };
      queue.current.push(...entries.map((entry, index) => ({ ...entry, batch, index })));
      pump();
    },
    [pump],
  );

  function addFiles(files: readonly File[]): void {
    if (files.length === 0) return;
    setStorageDown(false);
    setNotice(null);
    const entries = files.map((file) => {
      counter.current += 1;
      return { key: `upload-${counter.current}`, file };
    });
    setItems((current) => [
      ...current,
      ...entries.map(({ key, file }): Item => ({
        key,
        status: "uploading",
        image: null,
        file,
        error: null,
      })),
    ]);
    enqueue(entries);
  }

  function retry(item: Item): void {
    if (item.file === null) return;
    patch(item.key, { status: "uploading", error: null });
    enqueue([{ key: item.key, file: item.file }]);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    addFiles([...(event.target.files ?? [])]);
    event.target.value = "";
  }

  // ── dropping files on the card ──────────────────────────────────────────────────────────────
  const hasFiles = (event: DragEvent): boolean =>
    dragKey.current === null && [...(event.dataTransfer?.types ?? [])].includes("Files");

  function onZoneDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setFileOver(true);
  }

  function onZoneDrop(event: DragEvent): void {
    if (dragKey.current !== null) return;
    event.preventDefault();
    setFileOver(false);
    addFiles([...(event.dataTransfer?.files ?? [])]);
  }

  // ── ordering ────────────────────────────────────────────────────────────────────────────────
  const commitOrder = useCallback(
    async (nextReady: Item[]) => {
      const previous = items;
      setItems([...nextReady, ...pending]);
      if (productId === null) return;
      const state = await reorderProductMediaAction(
        IDLE,
        formOf({ productId, assetIds: nextReady.map((item) => item.image!.id) }),
      );
      if (state.status === "error") {
        setItems(previous);
        setNotice(m.reorderFailed);
      }
    },
    [items, pending, productId, m.reorderFailed],
  );

  function moveTo(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || to >= ready.length) return;
    setNotice(null);
    void commitOrder(moved(ready, from, to));
  }

  function onTileDrop(event: DragEvent, targetKey: string): void {
    const source = dragKey.current;
    if (source === null) return;
    event.preventDefault();
    event.stopPropagation();
    dragKey.current = null;
    moveTo(
      ready.findIndex((item) => item.key === source),
      ready.findIndex((item) => item.key === targetKey),
    );
  }

  // ── deleting ────────────────────────────────────────────────────────────────────────────────
  const deleteImages = useCallback(
    async (imageIds: readonly string[], confirmation: string): Promise<boolean> => {
      if (imageIds.length === 0 || !window.confirm(confirmation)) return false;
      setNotice(null);
      if (productId !== null) {
        const state = await detachProductMediaAction(
          IDLE,
          formOf({ productId, assetId: imageIds }),
        );
        if (state.status === "error") {
          setNotice(state.message);
          return false;
        }
      }
      setItems((current) =>
        current.filter((item) => item.image === null || !imageIds.includes(item.image.id)),
      );
      setSelected((current) => new Set([...current].filter((id) => !imageIds.includes(id))));
      return true;
    },
    [productId],
  );

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const describe = (item: Item, index: number): string =>
    item.image?.alt ??
    (productName.length > 0 ? productName : m.imageFallbackAlt.replace("{n}", String(index + 1)));

  const opened = ready.find((item) => item.image?.id === openId);
  const empty = items.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {storageDown && (
          <p role="alert" className="text-destructive text-sm">
            {m.storageNotSetUp}
          </p>
        )}
        {notice !== null && (
          <p role="alert" className="text-destructive text-sm">
            {notice}
          </p>
        )}

        {selected.size > 0 && (
          <div className="bg-muted flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-sm">
            <span role="status" className="font-medium">
              {m.selectedCount.replace("{count}", String(selected.size))}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void deleteImages(
                  [...selected],
                  selected.size === 1
                    ? m.confirmDelete
                    : m.confirmDeleteMany.replace("{count}", String(selected.size)),
                )
              }
            >
              {m.deleteSelected}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {m.clearSelection}
            </Button>
          </div>
        )}

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onPick}
        />

        <div
          data-testid="media-dropzone"
          onDragOver={onZoneDragOver}
          onDragLeave={() => setFileOver(false)}
          onDrop={onZoneDrop}
          className={cn(
            "rounded-lg transition-colors",
            empty && "border-border border-2 border-dashed p-8",
            fileOver && "bg-muted ring-primary ring-2",
          )}
        >
          {empty ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <ImagePlusIcon aria-hidden="true" className="text-muted-foreground size-8" />
              <p className="text-muted-foreground text-sm">{m.dropHere}</p>
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                {m.uploadNew}
              </Button>
              <p className="text-muted-foreground text-xs">{m.accepts}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ready.map((item, index) => {
                const image = item.image!;
                const label = String(index + 1);
                return (
                  <li
                    key={item.key}
                    data-testid={`media-tile-${image.id}`}
                    draggable
                    onDragStart={(event) => {
                      dragKey.current = item.key;
                      event.dataTransfer?.setData("text/plain", item.key);
                    }}
                    onDragEnd={() => {
                      dragKey.current = null;
                    }}
                    onDragOver={(event) => {
                      if (dragKey.current !== null) event.preventDefault();
                    }}
                    onDrop={(event) => onTileDrop(event, item.key)}
                    className={cn(
                      "border-border bg-muted group relative aspect-square overflow-hidden rounded-lg border",
                      index === 0 && "sm:col-span-2 sm:row-span-2",
                    )}
                  >
                    <button
                      type="button"
                      data-testid={`media-open-${image.id}`}
                      onClick={() => setOpenId(image.id)}
                      className="absolute inset-0"
                    >
                      <Image
                        src={image.url}
                        alt={describe(item, index)}
                        fill
                        sizes={index === 0 ? "(min-width: 640px) 50vw, 100vw" : "25vw"}
                        unoptimized
                        loading="lazy"
                        className="object-cover"
                      />
                    </button>
                    {index === 0 && (
                      <Badge className="pointer-events-none absolute bottom-2 start-2">
                        {m.featured}
                      </Badge>
                    )}
                    <label
                      className={cn(
                        "bg-background/90 absolute start-2 top-2 flex size-6 items-center justify-center rounded-md border",
                        selected.size === 0 &&
                          "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={m.select.replace("{n}", label)}
                        checked={selected.has(image.id)}
                        onChange={() => toggle(image.id)}
                      />
                    </label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          aria-label={m.imageActions.replace("{n}", label)}
                          className="absolute end-2 top-2 size-7 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                        >
                          <MoreHorizontalIcon aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setOpenId(image.id)}>
                          {m.edit}
                        </DropdownMenuItem>
                        {index > 0 && (
                          <DropdownMenuItem onSelect={() => moveTo(index, 0)}>
                            {m.makeFeatured}
                          </DropdownMenuItem>
                        )}
                        {index > 0 && (
                          <DropdownMenuItem onSelect={() => moveTo(index, index - 1)}>
                            {m.moveEarlier}
                          </DropdownMenuItem>
                        )}
                        {index < ready.length - 1 && (
                          <DropdownMenuItem onSelect={() => moveTo(index, index + 1)}>
                            {m.moveLater}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => void deleteImages([image.id], m.confirmDelete)}
                        >
                          {m.delete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}

              {pending.map((item) => (
                <li
                  key={item.key}
                  data-testid={`media-pending-${item.key}`}
                  className="border-border bg-muted text-muted-foreground flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border p-2 text-center text-xs"
                >
                  {item.status === "uploading" ? (
                    <>
                      <Loader2Icon aria-hidden="true" className="size-5 animate-spin" />
                      <span>{m.uploading}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-destructive font-medium">
                        {item.error === "too_large"
                          ? m.errorTooLarge
                          : item.error === "unsupported"
                            ? m.errorUnsupported
                            : m.errorFailed}
                      </span>
                      <div className="flex flex-wrap justify-center gap-1">
                        {item.file !== null && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => retry(item)}
                          >
                            {m.retry}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => drop(item.key)}
                        >
                          {m.dismiss}
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}

              <li className="aspect-square">
                <button
                  type="button"
                  aria-label={m.addMore}
                  onClick={() => inputRef.current?.click()}
                  className="border-border text-muted-foreground hover:bg-muted flex size-full items-center justify-center rounded-lg border-2 border-dashed"
                >
                  <PlusIcon aria-hidden="true" className="size-6" />
                </button>
              </li>
            </ul>
          )}
        </div>

        {productId === null &&
          ready.map((item) => (
            <input
              key={item.key}
              type="hidden"
              name="mediaAssetId"
              value={item.image!.id}
              form={formId}
            />
          ))}
      </CardContent>

      <Dialog
        open={opened !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        {opened !== undefined && (
          <ImageDialog
            key={opened.key}
            item={opened}
            position={ready.indexOf(opened) + 1}
            total={ready.length}
            productId={productId}
            fallbackAlt={describe(opened, ready.indexOf(opened))}
            t={t}
            onSaved={(alt) => patch(opened.key, { image: { ...opened.image!, alt } })}
            onDelete={async () => {
              if (await deleteImages([opened.image!.id], m.confirmDelete)) setOpenId(null);
            }}
            onClose={() => setOpenId(null)}
          />
        )}
      </Dialog>
    </Card>
  );
}

function ImageDialog({
  item,
  position,
  total,
  productId,
  fallbackAlt,
  t,
  onSaved,
  onDelete,
  onClose,
}: {
  readonly item: Item;
  readonly position: number;
  readonly total: number;
  readonly productId: string | null;
  readonly fallbackAlt: string;
  readonly t: Dictionary;
  readonly onSaved: (alt: string | null) => void;
  readonly onDelete: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const m = t.productMedia;
  const image = item.image!;
  const initial = image.alt ?? "";
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const changed = draft.trim() !== initial.trim();

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const state = await updateMediaAltAction(
      IDLE,
      formOf({
        ...(productId === null ? {} : { productId }),
        mediaId: image.id,
        alt: draft,
      }),
    );
    setSaving(false);
    if (state.status === "error") {
      setError(state.message);
      return;
    }
    onSaved(draft.trim().length === 0 ? null : draft.trim());
    onClose();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{m.dialogTitle}</DialogTitle>
        <DialogDescription>
          {m.dialogDescription.replace("{n}", String(position)).replace("{total}", String(total))}
        </DialogDescription>
      </DialogHeader>

      <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-lg">
        <Image
          src={image.url}
          alt={image.alt ?? fallbackAlt}
          fill
          sizes="(min-width: 640px) 32rem, 100vw"
          unoptimized
          loading="lazy"
          className="object-contain"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium">
          {m.altLabel}
        </label>
        <textarea
          id={fieldId}
          value={draft}
          maxLength={512}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
        />
        <p className="text-muted-foreground text-xs">{m.altHint}</p>
      </div>

      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => void onDelete()}>
          {m.delete}
        </Button>
        <Button
          type="button"
          loading={saving}
          disabled={!changed || saving}
          onClick={() => void save()}
        >
          {saving ? m.saving : m.save}
        </Button>
      </div>
    </DialogContent>
  );
}

function withFile(file: File): FormData {
  const form = new FormData();
  form.set("file", file);
  return form;
}
