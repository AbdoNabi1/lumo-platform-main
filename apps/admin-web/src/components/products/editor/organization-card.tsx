"use client";

import { Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import type { BrandDto } from "@/lib/api/brands";
import type { CategoryDto } from "@/lib/api/categories";
import type { Dictionary } from "@/messages/en";
import { CheckboxRow, Field, NativeSelect, PRODUCT_FORM_ID } from "./field";

/**
 * Type, vendor (brand), categories and tags. An assigned brand or category that is not in the
 * fetched first page still renders as its own option, labelled with its id, so a save never
 * silently drops it.
 */
export function OrganizationCard({
  productType,
  brandId,
  categoryIds,
  tags,
  brands,
  categories,
  errors,
  t,
}: {
  readonly productType: string;
  readonly brandId: string | null;
  readonly categoryIds: readonly string[];
  readonly tags: readonly string[];
  readonly brands: readonly BrandDto[];
  readonly categories: readonly CategoryDto[];
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}) {
  const editor = t.productEditor;
  const brandListed = brandId === null || brands.some((brand) => brand.id === brandId);
  const assigned = new Set(categoryIds);
  const listedCategories = new Set(categories.map((category) => category.id));
  const unlistedCategoryIds = categoryIds.filter((id) => !listedCategories.has(id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editor.organizationCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field
          label={editor.productType}
          name="productType"
          error={errors["productType"]}
          form={PRODUCT_FORM_ID}
        >
          {(control) => <Input {...control} defaultValue={productType} />}
        </Field>

        <Field label={editor.brand} name="brandId" error={errors["brandId"]} form={PRODUCT_FORM_ID}>
          {(control) => (
            <NativeSelect {...control} defaultValue={brandId ?? ""}>
              <option value="">{editor.noBrand}</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
              {!brandListed && brandId !== null && (
                <option value={brandId}>
                  {t.productBrandForm.unlistedOption.replace("{id}", brandId)}
                </option>
              )}
            </NativeSelect>
          )}
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <Label asChild>
            <legend>{editor.categories}</legend>
          </Label>
          {categories.map((category) => (
            <CheckboxRow
              key={category.id}
              name="categoryIds"
              form={PRODUCT_FORM_ID}
              value={category.id}
              label={category.name}
              defaultChecked={assigned.has(category.id)}
            />
          ))}
          {unlistedCategoryIds.map((id) => (
            <CheckboxRow
              key={id}
              name="categoryIds"
              form={PRODUCT_FORM_ID}
              value={id}
              label={id}
              defaultChecked
            />
          ))}
        </fieldset>

        <Field
          label={editor.tags}
          name="tags"
          error={errors["tags"]}
          hint={editor.tagsHint}
          form={PRODUCT_FORM_ID}
        >
          {(control) => <Input {...control} defaultValue={tags.join(", ")} />}
        </Field>
      </CardContent>
    </Card>
  );
}
