"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { handleFromTitle } from "@/lib/products/handles";
import type { Dictionary } from "@/messages/en";
import { Field, NativeTextarea, PRODUCT_FORM_ID } from "./field";

const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 320;
const PREVIEW_DESCRIPTION_CHARS = 160;

/** Search-engine listing: page title, meta description, URL handle, and a live preview. */
export function SeoCard({
  title,
  description,
  seoTitle: initialSeoTitle,
  seoDescription: initialSeoDescription,
  handle: initialHandle,
  isCreate,
  errors,
  t,
}: {
  /** The product title and description from the title card, used as the preview's fallbacks. */
  readonly title: string;
  readonly description: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly handle: string;
  readonly isCreate: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}) {
  const [seoTitle, setSeoTitle] = useState(initialSeoTitle);
  const [seoDescription, setSeoDescription] = useState(initialSeoDescription);
  const [handle, setHandle] = useState(initialHandle);

  const previewHandle = handle.trim() || handleFromTitle(title);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.seoCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          data-testid="seo-preview"
          className="border-border flex flex-col gap-0.5 rounded-md border p-3"
        >
          <p className="text-primary truncate text-base">{seoTitle.trim() || title || "—"}</p>
          <p dir="ltr" className="text-muted-foreground truncate text-start text-xs">
            …/products/{previewHandle}
          </p>
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {seoDescription.trim() || description.slice(0, PREVIEW_DESCRIPTION_CHARS)}
          </p>
        </div>

        <Field
          label={t.productEditor.seoTitle}
          name="seoTitle"
          error={errors["seoTitle"]}
          hint={`${seoTitle.length} / ${SEO_TITLE_MAX}`}
          form={PRODUCT_FORM_ID}
        >
          {(control) => (
            <Input
              {...control}
              maxLength={SEO_TITLE_MAX}
              value={seoTitle}
              onChange={(event) => setSeoTitle(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.productEditor.seoDescription}
          name="seoDescription"
          error={errors["seoDescription"]}
          hint={`${seoDescription.length} / ${SEO_DESCRIPTION_MAX}`}
          form={PRODUCT_FORM_ID}
        >
          {(control) => (
            <NativeTextarea
              {...control}
              className="min-h-20"
              maxLength={SEO_DESCRIPTION_MAX}
              value={seoDescription}
              onChange={(event) => setSeoDescription(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.productEditor.handle}
          name="handle"
          error={errors["handle"]}
          form={PRODUCT_FORM_ID}
        >
          {(control) => (
            <div dir="ltr" className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">/products/</span>
              <Input
                {...control}
                value={handle}
                placeholder={isCreate ? t.productEditor.skuAuto : undefined}
                onChange={(event) => setHandle(event.target.value)}
              />
            </div>
          )}
        </Field>
      </CardContent>
    </Card>
  );
}
