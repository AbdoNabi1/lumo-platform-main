"use client";

import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import type { Dictionary } from "@/messages/en";
import { Field, NativeTextarea, PRODUCT_FORM_ID } from "./field";

export function TitleDescriptionCard({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  errors,
  t,
}: {
  readonly title: string;
  readonly description: string;
  readonly onTitleChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.titleCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field
          label={t.productEditor.title}
          name="title"
          error={errors["title"]}
          form={PRODUCT_FORM_ID}
        >
          {(control) => (
            <Input
              {...control}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.productEditor.description}
          name="description"
          error={errors["description"]}
          form={PRODUCT_FORM_ID}
        >
          {(control) => (
            <NativeTextarea
              {...control}
              maxLength={20000}
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
          )}
        </Field>
      </CardContent>
    </Card>
  );
}
