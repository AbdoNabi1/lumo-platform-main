"use client";

import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import type { BrandDto } from "@/lib/api/brands";
import type { CategoryDto } from "@/lib/api/categories";
import type { Dictionary } from "@/messages/en";
import { TagsInput } from "./controls";
import { CheckboxRow, Field, PRODUCT_FORM_ID } from "./field";

/**
 * Type, vendor, categories and tags. The vendor is typed (the brands are only suggestions): a name
 * that matches a brand uses it, a new name makes one, blank clears it. An assigned category that is
 * not in the fetched first page still renders as its own checkbox, labelled with its id, so a save
 * never silently drops it. An assigned brand that is not in the first page cannot be named here, so
 * the field starts blank and posts `vendorKeep`: a blank vendor then means "leave it as it is".
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
  const brandsListId = useId();
  const assignedBrand = brandId === null ? undefined : brands.find((brand) => brand.id === brandId);
  const brandUnnameable = brandId !== null && assignedBrand === undefined;
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

        <Field label={editor.brand} name="vendor" error={errors["vendor"]} form={PRODUCT_FORM_ID}>
          {(control) => (
            <>
              <Input
                {...control}
                list={brandsListId}
                autoComplete="off"
                defaultValue={assignedBrand?.name ?? ""}
              />
              <datalist id={brandsListId}>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.name} />
                ))}
              </datalist>
              {brandUnnameable && (
                <input type="hidden" name="vendorKeep" value="1" form={PRODUCT_FORM_ID} />
              )}
            </>
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

        <TagsInput
          key={tags.join("\n")}
          name="tags"
          form={PRODUCT_FORM_ID}
          label={editor.tags}
          hint={editor.tagsHint}
          error={errors["tags"]}
          removeLabel={editor.removeTag}
          defaultTags={tags}
        />
      </CardContent>
    </Card>
  );
}
