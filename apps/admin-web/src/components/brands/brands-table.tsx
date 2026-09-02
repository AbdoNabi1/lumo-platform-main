"use client";

import { useActionState, useId } from "react";
import { CheckIcon } from "lucide-react";
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { deleteBrandAction, updateBrandAction } from "@/app/brands/actions";
import type { BrandDto } from "@/lib/api/brands";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

export function BrandsTable({
  brands,
  t,
}: {
  readonly brands: readonly BrandDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.brandsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.brandsPage.columns.name}</TableHead>
          <TableHead>{t.brandsPage.columns.slug}</TableHead>
          <TableHead className="text-end">{t.brandRowActions.rename}</TableHead>
          <TableHead className="text-end">{t.brandRowActions.delete}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {brands.map((brand) => (
          <BrandRow key={brand.id} brand={brand} t={t} />
        ))}
      </TableBody>
    </Table>
  );
}

function BrandRow({ brand, t }: { readonly brand: BrandDto; readonly t: Dictionary }) {
  const [renameState, renameFormAction, isRenamePending] = useActionState(
    updateBrandAction,
    INITIAL_STATE,
  );
  const [deleteState, deleteFormAction, isDeletePending] = useActionState(
    deleteBrandAction,
    INITIAL_STATE,
  );
  const formId = useId();

  return (
    <TableRow>
      <TableCell className="font-medium">{brand.name}</TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">{brand.slug}</TableCell>
      <TableCell>
        <form action={renameFormAction} className="flex items-center justify-end gap-2">
          <input type="hidden" name="brandId" value={brand.id} />
          <label htmlFor={`${formId}-name`} className="sr-only">
            {t.brandRowActions.rename}
          </label>
          <Input
            id={`${formId}-name`}
            name="name"
            defaultValue={brand.name}
            className="h-8 w-40 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            loading={isRenamePending}
            disabled={isRenamePending}
          >
            {isRenamePending ? t.brandRowActions.renaming : t.brandRowActions.rename}
          </Button>
          {renameState.status === "success" && (
            <CheckIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
          )}
        </form>
        {renameState.status === "error" && (
          <p role="alert" className="text-destructive text-end text-xs">
            {renameState.message}
          </p>
        )}
      </TableCell>
      <TableCell>
        <form
          action={deleteFormAction}
          className="flex justify-end"
          onSubmit={(event) => {
            if (!window.confirm(t.brandRowActions.confirmDelete)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="brandId" value={brand.id} />
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            loading={isDeletePending}
            disabled={isDeletePending}
          >
            {isDeletePending ? t.brandRowActions.deleting : t.brandRowActions.delete}
          </Button>
        </form>
        {deleteState.status === "error" && (
          <p role="alert" className="text-destructive text-end text-xs">
            {deleteState.message}
          </p>
        )}
      </TableCell>
    </TableRow>
  );
}
