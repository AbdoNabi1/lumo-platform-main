import { Suspense } from "react";
import { cookies } from "next/headers";
import { Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { FilesResults } from "@/components/content/files/files-results";
import {
  FilesToolbar,
  type FilesSort,
  type FilesView,
} from "@/components/content/files/files-toolbar";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The API caps `search` at 100 characters (a longer one is a 422). */
const MAX_SEARCH = 100;

interface FilesPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly sort?: string;
    readonly view?: string;
    readonly after?: string;
    readonly stack?: string;
  }>;
}

/**
 * Content > Files: the store's uploaded images, newest first, with search, a grid or list view and
 * cursor pagination (`after` is the cursor, `stack` the cursors of the pages before it — only the
 * pagination control reads that). Everyone with `media_library:read` can browse; uploading, alt text,
 * download and delete are operator-and-up (the API enforces it; the controls are hidden for viewers).
 */
export default async function FilesPage({ searchParams }: FilesPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, params] = await Promise.all([
    getCurrentUser(),
    readSession(),
    searchParams,
  ]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";

  const q = (params.q ?? "").trim().slice(0, MAX_SEARCH);
  const sort: FilesSort = params.sort === "oldest" ? "oldest" : "newest";
  const view: FilesView = params.view === "list" ? "list" : "grid";
  const after = params.after !== undefined && params.after.length > 0 ? params.after : undefined;

  return (
    <AppShell t={t} locale={locale} activeNavId="content-files" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t.files.title}</h1>
        </header>

        <FilesToolbar q={q} sort={sort} view={view} canEdit={canEdit} t={t} />

        <Suspense key={`${q}|${sort}|${view}|${after ?? ""}`} fallback={<FilesSkeleton />}>
          <FilesResults
            q={q}
            sort={sort}
            view={view}
            after={after}
            canEdit={canEdit}
            t={t}
            locale={locale}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

function FilesSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
