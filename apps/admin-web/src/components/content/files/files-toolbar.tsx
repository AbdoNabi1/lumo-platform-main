"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGridIcon, ListIcon, SearchIcon } from "lucide-react";
import { Button, Input, Label, NativeSelect } from "@platform/ui";
import type { Dictionary } from "@/messages/en";
import { FilesUploadButton } from "./files-upload-button";

export type FilesSort = "newest" | "oldest";
export type FilesView = "grid" | "list";

/**
 * Search, sort, the grid/list toggle and (operators and up) the Upload button. The URL holds all
 * state. A new search or a new sort starts again at page one (`after` and `stack` go); the view
 * toggle only changes how the same page is drawn, so it keeps them.
 */
export function FilesToolbar({
  q,
  sort,
  view,
  canEdit,
  t,
}: {
  readonly q: string;
  readonly sort: FilesSort;
  readonly view: FilesView;
  readonly canEdit: boolean;
  readonly t: Dictionary;
}) {
  const f = t.files;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(q);

  useEffect(() => {
    setValue(q);
  }, [q]);

  function push(params: URLSearchParams): void {
    const query = params.toString();
    router.push(query === "" ? pathname : `${pathname}?${query}`);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    const next = value.trim();
    if (next === "") params.delete("q");
    else params.set("q", next);
    params.delete("after");
    params.delete("stack");
    push(params);
  }

  function changeSort(next: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", next);
    params.delete("after");
    params.delete("stack");
    push(params);
  }

  function changeView(next: FilesView): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    push(params);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <form
        role="search"
        onSubmit={submitSearch}
        className="flex min-w-60 flex-1 items-center gap-2"
      >
        <div className="relative w-full sm:max-w-sm">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          />
          <Label htmlFor="files-search" className="sr-only">
            {f.searchLabel}
          </Label>
          <Input
            id="files-search"
            type="search"
            name="q"
            dir="auto"
            maxLength={100}
            placeholder={f.searchPlaceholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="ps-9"
          />
        </div>
        <Button type="submit" variant="outline">
          {f.searchSubmit}
        </Button>
      </form>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="files-sort" className="sr-only">
          {f.sortLabel}
        </Label>
        <NativeSelect
          id="files-sort"
          value={sort}
          onChange={(event) => changeSort(event.target.value)}
        >
          <option value="newest">{f.sortNewest}</option>
          <option value="oldest">{f.sortOldest}</option>
        </NativeSelect>
      </div>

      <div role="group" aria-label={f.viewLabel} className="flex items-center gap-1">
        <Button
          type="button"
          variant={view === "grid" ? "secondary" : "outline"}
          size="icon"
          aria-label={f.viewGrid}
          aria-pressed={view === "grid"}
          onClick={() => changeView("grid")}
        >
          <LayoutGridIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant={view === "list" ? "secondary" : "outline"}
          size="icon"
          aria-label={f.viewList}
          aria-pressed={view === "list"}
          onClick={() => changeView("list")}
        >
          <ListIcon aria-hidden="true" />
        </Button>
      </div>

      {canEdit ? <FilesUploadButton t={t} /> : null}
    </div>
  );
}
