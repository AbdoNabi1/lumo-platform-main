"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { Dictionary } from "@/messages/en";
import { ProductStatusBadge } from "../product-status-badge";
import { StatusPicker } from "./controls";
import { PRODUCT_FORM_ID } from "./field";

type EditableStatus = "published" | "draft" | "unlisted";

const EDITABLE: readonly EditableStatus[] = ["published", "draft", "unlisted"];

function isEditable(status: string): status is EditableStatus {
  return (EDITABLE as readonly string[]).includes(status);
}

/**
 * Active / Draft / Unlisted, as a menu that explains each choice. An archived or scheduled product
 * has no picker: the domain has no transition from those through a plain Save, so the badge and a
 * pointer to the actions card stand in, and the server ignores `status` for them.
 */
export function StatusCard({
  status,
  errors,
  t,
}: {
  readonly status: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}) {
  const editor = t.productEditor;
  const hints: Readonly<Record<EditableStatus, string>> = {
    published: editor.statusPublishedHint,
    draft: editor.statusDraftHint,
    unlisted: editor.statusUnlistedHint,
  };
  const error = errors["status"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editor.statusCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isEditable(status) ? (
          <>
            <StatusPicker
              name="status"
              label={editor.statusCard}
              form={PRODUCT_FORM_ID}
              value={status}
              options={EDITABLE.map((value) => ({
                value,
                label: t.productStatus[value],
                description: hints[value],
              }))}
            />
            {error !== undefined && <p className="text-destructive text-xs">{error}</p>}
          </>
        ) : (
          <>
            <div>
              <ProductStatusBadge status={status} t={t} />
            </div>
            <p className="text-muted-foreground text-xs">{editor.statusLocked}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
