"use client";

import { useActionState, useId, useState } from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  assignProductCategoriesAction,
  setProductBrandAction,
  setProductOptionsAction,
} from "@/app/products/actions";
import type { BrandDto } from "@/lib/api/brands";
import type { CategoryDto } from "@/lib/api/categories";
import type { FormState } from "@/lib/api/mutation";
import type { ProductOptionDto } from "@/lib/api/products";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * T5.7: real pickers, backed by `fetchBrandsPage`/`fetchCategoriesPage` — closes the gap
 * `docs/plans/BLOCKERS.md`'s T5.1 entry left open (no `GET /brands` route existed at all, and
 * `GET /categories` returned the raw `Category` domain aggregate un-DTO'd). Both lists are fetched
 * server-side by the parent (`app/products/[productId]/page.tsx`) and passed down as plain DTO
 * arrays — never fetched from this Client Component, per the repo-wide "never call the runtime API
 * from browser JS" rule. Only the first page of each list is available here (no search-as-you-type
 * picker in scope); a currently-assigned id that isn't on that first page still renders as its own
 * option so saving never silently drops it.
 */
export function ProductOrganizationCard({
  productId,
  brandId,
  categoryIds,
  options,
  brands,
  categories,
  t,
}: {
  readonly productId: string;
  readonly brandId: string | null;
  readonly categoryIds: readonly string[];
  readonly options: readonly ProductOptionDto[];
  readonly brands: readonly BrandDto[];
  readonly categories: readonly CategoryDto[];
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productDetail.categories}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <BrandForm productId={productId} brandId={brandId} brands={brands} t={t} />
        <CategoriesForm
          productId={productId}
          categoryIds={categoryIds}
          categories={categories}
          t={t}
        />
        <OptionsForm productId={productId} options={options} t={t} />
      </CardContent>
    </Card>
  );
}

function BrandForm({
  productId,
  brandId,
  brands,
  t,
}: {
  readonly productId: string;
  readonly brandId: string | null;
  readonly brands: readonly BrandDto[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(setProductBrandAction, INITIAL_STATE);
  const formId = useId();
  const isUnlisted = brandId !== null && !brands.some((brand) => brand.id === brandId);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs font-medium">{t.productDetail.brand}</p>
      <form action={formAction} className="flex items-end gap-2">
        <input type="hidden" name="productId" value={productId} />
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`${formId}-brandId`} className="sr-only">
            {t.productBrandForm.brandId}
          </Label>
          <select
            id={`${formId}-brandId`}
            name="brandId"
            defaultValue={brandId ?? ""}
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-8 rounded-md border px-2 text-xs transition-colors ease-out"
          >
            <option value="">{t.productBrandForm.none}</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
            {isUnlisted && brandId !== null && (
              <option value={brandId}>
                {t.productBrandForm.unlistedOption.replace("{id}", brandId)}
              </option>
            )}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.productBrandForm.saving : t.productBrandForm.save}
        </Button>
      </form>
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
    </div>
  );
}

function CategoriesForm({
  productId,
  categoryIds,
  categories,
  t,
}: {
  readonly productId: string;
  readonly categoryIds: readonly string[];
  readonly categories: readonly CategoryDto[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    assignProductCategoriesAction,
    INITIAL_STATE,
  );
  const assigned = new Set(categoryIds);
  const unlistedIds = categoryIds.filter(
    (categoryId) => !categories.some((category) => category.id === categoryId),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs font-medium">{t.productCategoriesForm.categoryIds}</p>
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="productId" value={productId} />
        {categories.length === 0 && unlistedIds.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t.productCategoriesForm.noCategoriesAvailable}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {categories.map((category) => (
              <label key={category.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="categoryIds"
                  value={category.id}
                  defaultChecked={assigned.has(category.id)}
                />
                {category.name}
              </label>
            ))}
            {unlistedIds.map((categoryId) => (
              <label key={categoryId} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="categoryIds"
                  value={categoryId}
                  defaultChecked
                />
                {t.productCategoriesForm.categoryIds}: {categoryId}
              </label>
            ))}
          </div>
        )}
        <div>
          <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
            {isPending ? t.productCategoriesForm.saving : t.productCategoriesForm.save}
          </Button>
        </div>
      </form>
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
    </div>
  );
}

interface OptionRow {
  readonly key: string;
  readonly name: string;
  readonly values: string;
}

let nextOptionRowKey = 0;
function newOptionRowKey(): string {
  nextOptionRowKey += 1;
  return `option-row-${nextOptionRowKey}`;
}

/**
 * Full-replace editor for the declared option matrix. Backend-enforced draft-only (see
 * `setProductOptions`) — deliberately not pre-blocked here on `product.status`, per the brief: a
 * rejection on a published product surfaces as a normal form error instead.
 */
function OptionsForm({
  productId,
  options,
  t,
}: {
  readonly productId: string;
  readonly options: readonly ProductOptionDto[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(setProductOptionsAction, INITIAL_STATE);
  const [rows, setRows] = useState<readonly OptionRow[]>(() =>
    options.length === 0
      ? [{ key: newOptionRowKey(), name: "", values: "" }]
      : options.map((option) => ({
          key: newOptionRowKey(),
          name: option.name,
          values: option.values.join(", "),
        })),
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  function addRow(): void {
    setRows((current) => [...current, { key: newOptionRowKey(), name: "", values: "" }]);
  }

  function removeRow(key: string): void {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-medium">{t.productOptionsForm.title}</p>
        <Button type="button" variant="ghost" size="sm" onClick={addRow}>
          <PlusIcon aria-hidden="true" />
          {t.productOptionsForm.addOption}
        </Button>
      </div>

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="productId" value={productId} />
        {rows.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[1fr_1fr_2rem] items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${formId}-name-${index}`} className={index > 0 ? "sr-only" : "text-xs"}>
                {t.productOptionsForm.optionName}
              </Label>
              <Input
                id={`${formId}-name-${index}`}
                name="optionName"
                defaultValue={row.name}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`${formId}-values-${index}`}
                className={index > 0 ? "sr-only" : "text-xs"}
              >
                {t.productOptionsForm.optionValues}
              </Label>
              <Input
                id={`${formId}-values-${index}`}
                name="optionValues"
                defaultValue={row.values}
                className="h-8 text-xs"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={rows.length === 1}
              onClick={() => removeRow(row.key)}
              aria-label={t.productOptionsForm.removeOption}
            >
              <XIcon aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ))}

        <div>
          <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
            {isPending ? t.productOptionsForm.saving : t.productOptionsForm.save}
          </Button>
        </div>

        {fieldErrors["options"] !== undefined && (
          <p className="text-destructive text-xs">{fieldErrors["options"]}</p>
        )}
        {state.status === "error" && fieldErrors["options"] === undefined && (
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
    </div>
  );
}
