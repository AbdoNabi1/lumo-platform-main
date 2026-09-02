"use client";

import { useActionState, useId, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  attachProductMediaAction,
  detachProductMediaAction,
  reorderProductMediaAction,
  setProductSeoAction,
} from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** One attached media asset with its (possibly unresolved) download link — see T3.6. */
export interface ProductMediaAsset {
  readonly id: string;
  readonly url: string | null;
}

export function ProductMediaSeoCard({
  productId,
  mediaAssets,
  seoTitle,
  seoDescription,
  t,
}: {
  readonly productId: string;
  readonly mediaAssets: readonly ProductMediaAsset[];
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productDetail.media}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <MediaSection productId={productId} mediaAssets={mediaAssets} t={t} />
        <SeoForm
          productId={productId}
          seoTitle={seoTitle}
          seoDescription={seoDescription}
          t={t}
        />
      </CardContent>
    </Card>
  );
}

function MediaSection({
  productId,
  mediaAssets,
  t,
}: {
  readonly productId: string;
  readonly mediaAssets: readonly ProductMediaAsset[];
  readonly t: Dictionary;
}) {
  const [order, setOrder] = useState(mediaAssets);

  function moveUp(index: number): void {
    if (index === 0) return;
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(index - 1, 0, item);
      return next;
    });
  }

  function moveDown(index: number): void {
    setOrder((current) => {
      if (index >= current.length - 1) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(index + 1, 0, item);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {order.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.productDetail.noMedia}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {order.map((asset, index) => (
            <li
              key={asset.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {t.productDetail.mediaReference}:{" "}
                {asset.url !== null ? (
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary font-mono text-xs underline underline-offset-2"
                  >
                    {asset.id}
                  </a>
                ) : (
                  <>
                    <span className="font-mono text-xs">{asset.id}</span>{" "}
                    <span className="text-xs">({t.productDetail.mediaDownloadUnavailable})</span>
                  </>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === 0}
                  onClick={() => moveUp(index)}
                  aria-label={t.productMediaForm.moveUp}
                >
                  <ArrowUpIcon aria-hidden="true" className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === order.length - 1}
                  onClick={() => moveDown(index)}
                  aria-label={t.productMediaForm.moveDown}
                >
                  <ArrowDownIcon aria-hidden="true" className="size-3.5" />
                </Button>
                <DetachMediaButton productId={productId} assetId={asset.id} t={t} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {order.length > 1 && <SaveOrderForm productId={productId} order={order} t={t} />}

      <AttachMediaForm productId={productId} t={t} />
    </div>
  );
}

function SaveOrderForm({
  productId,
  order,
  t,
}: {
  readonly productId: string;
  readonly order: readonly ProductMediaAsset[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(reorderProductMediaAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="productId" value={productId} />
      {order.map((asset) => (
        <input key={asset.id} type="hidden" name="assetIds" value={asset.id} />
      ))}
      <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
        {isPending ? t.productMediaForm.savingOrder : t.productMediaForm.saveOrder}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
          <CheckIcon aria-hidden="true" className="size-3.5" />
          {t.productWriteCommon.saved}
        </p>
      )}
    </form>
  );
}

function DetachMediaButton({
  productId,
  assetId,
  t,
}: {
  readonly productId: string;
  readonly assetId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(detachProductMediaAction, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.productMediaForm.confirmDetach)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="assetId" value={assetId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        loading={isPending}
        disabled={isPending}
      >
        {isPending ? t.productMediaForm.detaching : t.productMediaForm.detach}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

function AttachMediaForm({
  productId,
  t,
}: {
  readonly productId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(attachProductMediaAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="productId" value={productId} />
      <p className="text-muted-foreground text-xs font-medium">{t.productMediaForm.attachTitle}</p>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`${formId}-assetId`} className="sr-only">
            {t.productMediaForm.assetId}
          </Label>
          <Input
            id={`${formId}-assetId`}
            name="assetId"
            placeholder={t.productMediaForm.assetId}
            className="h-8 text-xs"
            aria-invalid={fieldErrors["assetId"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.productMediaForm.attaching : t.productMediaForm.attach}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
          <CheckIcon aria-hidden="true" className="size-3.5" />
          {t.productWriteCommon.saved}
        </p>
      )}
    </form>
  );
}

function SeoForm({
  productId,
  seoTitle,
  seoDescription,
  t,
}: {
  readonly productId: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(setProductSeoAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <p className="text-muted-foreground text-xs font-medium">{t.productSeoForm.title}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-title`} className="text-xs">
          {t.productSeoForm.seoTitle}
        </Label>
        <Input
          id={`${formId}-title`}
          name="title"
          defaultValue={seoTitle ?? ""}
          className="h-8 text-xs"
          aria-invalid={fieldErrors["title"] !== undefined || undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-description`} className="text-xs">
          {t.productSeoForm.seoDescription}
        </Label>
        <Input
          id={`${formId}-description`}
          name="description"
          defaultValue={seoDescription ?? ""}
          className="h-8 text-xs"
          aria-invalid={fieldErrors["description"] !== undefined || undefined}
        />
      </div>
      <div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.productSeoForm.saving : t.productSeoForm.save}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
          <CheckIcon aria-hidden="true" className="size-3.5" />
          {t.productWriteCommon.saved}
        </p>
      )}
    </form>
  );
}
