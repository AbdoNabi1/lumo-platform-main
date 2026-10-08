"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { Dictionary } from "@/messages/en";
import { ProductStatusBadge } from "../product-status-badge";
import { Field, NativeSelect, PRODUCT_FORM_ID } from "./field";

type EditableStatus = "published" | "draft" | "unlisted";

const EDITABLE: readonly EditableStatus[] = ["published", "draft", "unlisted"];

function isEditable(status: string): status is EditableStatus {
  return (EDITABLE as readonly string[]).includes(status);
}

/**
 * Active / Draft / Unlisted. An archived or scheduled product has no select: the domain has no
 * transition from those through a plain Save, so the badge and a pointer to the actions card stand
 * in, and the server ignores `status` for them.
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
  const [selected, setSelected] = useState<EditableStatus>(isEditable(status) ? status : "draft");
  const editor = t.productEditor;
  const hints: Readonly<Record<EditableStatus, string>> = {
    published: editor.statusPublishedHint,
    draft: editor.statusDraftHint,
    unlisted: editor.statusUnlistedHint,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editor.statusCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isEditable(status) ? (
          <Field
            label={editor.statusCard}
            name="status"
            error={errors["status"]}
            form={PRODUCT_FORM_ID}
          >
            {(control) => (
              <>
                <NativeSelect
                  {...control}
                  value={selected}
                  onChange={(event) => setSelected(event.target.value as EditableStatus)}
                >
                  {EDITABLE.map((value) => (
                    <option key={value} value={value}>
                      {t.productStatus[value]}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-muted-foreground text-xs">{hints[selected]}</p>
              </>
            )}
          </Field>
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
