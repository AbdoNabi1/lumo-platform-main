"use client";

import { useActionState, useId } from "react";
import { CheckIcon } from "lucide-react";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { deleteCategoryAction, moveCategoryAction } from "@/app/categories/actions";
import type { CategoryDto } from "@/lib/api/categories";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

export function CategoriesTable({
  categories,
  t,
}: {
  readonly categories: readonly CategoryDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.categoriesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.categoriesPage.columns.name}</TableHead>
          <TableHead>{t.categoriesPage.columns.slug}</TableHead>
          <TableHead>{t.categoriesPage.columns.parent}</TableHead>
          <TableHead className="text-end">{t.categoryRowActions.moveTo}</TableHead>
          <TableHead className="text-end">{t.categoryRowActions.delete}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} categories={categories} t={t} />
        ))}
      </TableBody>
    </Table>
  );
}

function CategoryRow({
  category,
  categories,
  t,
}: {
  readonly category: CategoryDto;
  readonly categories: readonly CategoryDto[];
  readonly t: Dictionary;
}) {
  const [moveState, moveFormAction, isMovePending] = useActionState(
    moveCategoryAction,
    INITIAL_STATE,
  );
  const [deleteState, deleteFormAction, isDeletePending] = useActionState(
    deleteCategoryAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const parentName = categories.find((c) => c.id === category.parentId)?.name ?? category.parentId;

  return (
    <TableRow>
      <TableCell className="font-medium">{category.name}</TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">{category.slug}</TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {category.parentId === null ? t.categoriesPage.noParent : parentName}
      </TableCell>
      <TableCell>
        <form action={moveFormAction} className="flex items-center justify-end gap-2">
          <input type="hidden" name="categoryId" value={category.id} />
          <label htmlFor={`${formId}-newParentId`} className="sr-only">
            {t.categoryRowActions.moveTo}
          </label>
          <select
            id={`${formId}-newParentId`}
            name="newParentId"
            defaultValue={category.parentId ?? ""}
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-8 rounded-md border px-2 text-xs transition-colors ease-out"
          >
            <option value="">{t.categoriesPage.noParent}</option>
            {categories
              .filter((candidate) => candidate.id !== category.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
          <Button type="submit" size="sm" variant="outline" loading={isMovePending} disabled={isMovePending}>
            {isMovePending ? t.categoryRowActions.moving : t.categoryRowActions.move}
          </Button>
          {moveState.status === "success" && (
            <CheckIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
          )}
        </form>
        {moveState.status === "error" && (
          <p role="alert" className="text-destructive text-end text-xs">
            {moveState.message}
          </p>
        )}
      </TableCell>
      <TableCell>
        <form
          action={deleteFormAction}
          className="flex justify-end"
          onSubmit={(event) => {
            if (!window.confirm(t.categoryRowActions.confirmDelete)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="categoryId" value={category.id} />
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            loading={isDeletePending}
            disabled={isDeletePending}
          >
            {isDeletePending ? t.categoryRowActions.deleting : t.categoryRowActions.delete}
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
