import type { ReactNode } from "react";
import { AlertTriangleIcon, ImageIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { fetchMediaFilesPage } from "@/lib/api/media";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FilesBrowser } from "./files-browser";
import { FilesGrid } from "./files-grid";
import { FilesPagination } from "./files-pagination";
import { FilesTable } from "./files-table";
import type { FilesSort, FilesView } from "./files-toolbar";
import { FilesUploadButton } from "./files-upload-button";

export const FILES_PAGE_SIZE = 50;

/**
 * One page of the library as a grid or a list, or the state that stands in for it: signed out, a
 * load error, a search with no hits, or an empty library (which invites an operator to upload).
 * A server component — it reads the page's data itself, so it can sit behind a `Suspense`.
 * Everything it returns sits inside `FilesBrowser`, which owns the file dialogs.
 */
export async function FilesResults({
  q,
  sort,
  view,
  after,
  canEdit,
  t,
  locale,
}: {
  readonly q: string;
  readonly sort: FilesSort;
  readonly view: FilesView;
  readonly after: string | undefined;
  readonly canEdit: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchMediaFilesPage({
    first: FILES_PAGE_SIZE,
    ...(after === undefined ? {} : { after }),
    ...(q === "" ? {} : { search: q }),
    sort,
  });

  return (
    <FilesBrowser canEdit={canEdit} t={t} locale={locale}>
      {renderBody({ result, q, view, after, canEdit, t, locale })}
    </FilesBrowser>
  );
}

type FilesResult = Awaited<ReturnType<typeof fetchMediaFilesPage>>;

/**
 * The page's content for one API answer. It is always wrapped by `FilesBrowser` (above), whatever
 * this returns, so an open details dialog survives the list turning empty after a delete.
 */
function renderBody({
  result,
  q,
  view,
  after,
  canEdit,
  t,
  locale,
}: {
  readonly result: FilesResult;
  readonly q: string;
  readonly view: FilesView;
  readonly after: string | undefined;
  readonly canEdit: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}): ReactNode {
  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.files.unauthorized}
      />
    );
  }
  if (result.outcome !== "ok") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.files.error}
      />
    );
  }

  const { items, pageInfo } = result.data;
  const pagination = (
    <FilesPagination hasNextPage={pageInfo.hasNextPage} endCursor={pageInfo.endCursor} t={t} />
  );
  if (items.length === 0) {
    // Past the first page the library is not empty — the cursor ran out (a stale link, or the
    // page's last file was just deleted) — so say that and keep Previous within reach.
    if (after !== undefined) {
      return (
        <div className="flex flex-col gap-4">
          <StatePanel
            icon={<ImageIcon aria-hidden="true" className="size-5" />}
            message={t.files.noMoreFiles}
          />
          {pagination}
        </div>
      );
    }
    // A search with no hits is not an empty library.
    if (q !== "") {
      return (
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.files.noMatches}
        />
      );
    }
    return (
      <StatePanel
        icon={<ImageIcon aria-hidden="true" className="size-8" />}
        title={canEdit ? t.files.emptyTitle : undefined}
        message={canEdit ? t.files.emptyBody : t.files.emptyViewerBody}
      >
        {canEdit ? <FilesUploadButton t={t} /> : null}
      </StatePanel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {view === "list" ? (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <FilesTable files={items} t={t} locale={locale} />
          </CardContent>
        </Card>
      ) : (
        <FilesGrid files={items} t={t} locale={locale} />
      )}
      {pagination}
    </div>
  );
}

function StatePanel({
  icon,
  title,
  message,
  children,
}: {
  readonly icon: ReactNode;
  readonly title?: string | undefined;
  readonly message: string;
  readonly children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-3 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        {title !== undefined ? (
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        ) : null}
        <p role="note">{message}</p>
        {children}
      </CardContent>
    </Card>
  );
}
