"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { archiveFileAction } from "@/app/content/files/actions";
import type { MediaFileDto } from "@/lib/api/media";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FileDeleteDialog } from "./file-delete-dialog";
import { FileDetailsDialog } from "./file-details-dialog";

/** Marks the tile or row button of a file, so focus can be handed to a surviving neighbour. */
export const FILE_TILE_ATTRIBUTE = "data-file-id";
/** The toolbar's search input: the stable control focus falls back to when no file is left. */
const SEARCH_INPUT_ID = "files-search";

interface Selection {
  readonly file: MediaFileDto;
  /** Files after this one in the page, nearest first. */
  readonly nextIds: readonly string[];
  /** Files before this one in the page, nearest first. */
  readonly prevIds: readonly string[];
}

interface FileDetailsApi {
  readonly openFile: (file: MediaFileDto, orderedIds: readonly string[]) => void;
}

const FileDetailsContext = createContext<FileDetailsApi | null>(null);

/** What a tile or row calls to open the details of its file. */
export function useFileDetails(): FileDetailsApi {
  const api = useContext(FileDetailsContext);
  if (api === null) throw new Error("useFileDetails must be used inside <FilesBrowser>.");
  return api;
}

/**
 * Owns the details dialog, the delete confirmation and the delete request for the whole results
 * area, *above* the grid, the list and the empty states. A delete revalidates the page, so the
 * opened file's tile (or the whole grid, when it was the last file) can vanish while the dialogs
 * are still on screen; because the selected file is a snapshot held here, they survive that, and
 * focus is moved deliberately instead of being dropped on the page.
 *
 * Closing sequence after a successful delete: the confirmation closes first and, in its own
 * close-focus handler, focus goes back to the still-mounted Delete button; only then does the details
 * dialog close, and its close-focus handler moves focus to the next surviving file, else the
 * previous one, else the Search files input. The request is owned here rather than by the
 * confirmation, so Escape/Cancel can dismiss the confirmation while it is in flight (the server
 * request is not cancelled), a second submit is refused, and the outcome only touches a dialog that
 * is still showing the same file.
 */
export function FilesBrowser({
  canEdit,
  t,
  locale,
  children,
}: {
  readonly canEdit: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<readonly string[]>([]);
  const [deleteError, setDeleteError] = useState<{
    readonly id: string;
    readonly message: string;
  } | null>(null);

  // Current values for the async delete completion, which outlives the render it started in.
  const live = useRef({ selection: null as Selection | null, details: false, confirm: false });
  const inFlight = useRef(new Set<string>());
  const archived = useRef(new Set<string>());
  const closeDetailsAfterHandoff = useRef(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  const showDetails = useCallback((value: boolean) => {
    live.current.details = value;
    setDetailsOpen(value);
  }, []);
  const showConfirm = useCallback((value: boolean) => {
    live.current.confirm = value;
    setConfirmOpen(value);
  }, []);

  const openFile = useCallback(
    (file: MediaFileDto, orderedIds: readonly string[]) => {
      const index = orderedIds.indexOf(file.id);
      const next: Selection = {
        file,
        nextIds: index < 0 ? [] : orderedIds.slice(index + 1),
        prevIds: index < 0 ? [] : orderedIds.slice(0, index).reverse(),
      };
      live.current.selection = next;
      closeDetailsAfterHandoff.current = false;
      setSelection(next);
      setDeleteError(null);
      showConfirm(false);
      showDetails(true);
    },
    [showConfirm, showDetails],
  );
  const api = useMemo<FileDetailsApi>(() => ({ openFile }), [openFile]);

  /** A delete finished: close what is still showing that file; leave anything else alone. */
  const settleDeleted = useCallback(
    (id: string) => {
      archived.current.add(id);
      if (live.current.selection?.file.id !== id) return;
      if (live.current.confirm) {
        closeDetailsAfterHandoff.current = true;
        showConfirm(false);
      } else if (live.current.details) {
        showDetails(false);
      }
    },
    [showConfirm, showDetails],
  );

  const confirmDelete = useCallback(async (): Promise<void> => {
    const id = live.current.selection?.file.id;
    if (id === undefined || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setPendingIds([...inFlight.current]);
    setDeleteError(null);
    let failure: string | null = null;
    try {
      const state = await archiveFileAction(id);
      if (state.status === "error") failure = state.message;
    } catch {
      failure = t.formErrors.unexpected;
    }
    inFlight.current.delete(id);
    setPendingIds([...inFlight.current]);
    if (failure !== null) setDeleteError({ id, message: failure });
    else settleDeleted(id);
  }, [settleDeleted, t.formErrors.unexpected]);

  const onConfirmOpenChange = useCallback(
    (next: boolean) => {
      showConfirm(next);
      const id = live.current.selection?.file.id;
      // A refusal is cleared by a fresh attempt or a dismissal — but not while the request it
      // belongs to is still in flight (its answer has not arrived yet).
      if (next || id === undefined || !inFlight.current.has(id)) setDeleteError(null);
    },
    [showConfirm],
  );

  const onConfirmCloseAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      deleteTrigger.current?.focus();
      if (closeDetailsAfterHandoff.current) {
        closeDetailsAfterHandoff.current = false;
        showDetails(false);
      }
    },
    [showDetails],
  );

  const onDetailsCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const current = live.current.selection;
    if (current === null) return;
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(`[${FILE_TILE_ATTRIBUTE}]`));
    const tileOf = (id: string) =>
      tiles.find((element) => element.getAttribute(FILE_TILE_ATTRIBUTE) === id);
    const own = archived.current.has(current.file.id) ? undefined : tileOf(current.file.id);
    const neighbour = [...current.nextIds, ...current.prevIds]
      .filter((id) => !archived.current.has(id))
      .map(tileOf)
      .find((element) => element !== undefined);
    (own ?? neighbour ?? document.getElementById(SEARCH_INPUT_ID))?.focus();
  }, []);

  const file = selection?.file ?? null;
  const pending = file !== null && pendingIds.includes(file.id);
  const ownError = file !== null && deleteError?.id === file.id ? deleteError.message : null;

  return (
    <FileDetailsContext.Provider value={api}>
      {children}
      {file !== null ? (
        <FileDetailsDialog
          file={file}
          canEdit={canEdit}
          t={t}
          locale={locale}
          open={detailsOpen}
          onOpenChange={showDetails}
          onCloseAutoFocus={onDetailsCloseAutoFocus}
          deleteNotice={confirmOpen ? null : ownError}
          deleteControl={
            <FileDeleteDialog
              name={file.name}
              t={t}
              open={confirmOpen}
              onOpenChange={onConfirmOpenChange}
              pending={pending}
              error={ownError}
              onConfirm={() => void confirmDelete()}
              onCloseAutoFocus={onConfirmCloseAutoFocus}
              triggerRef={deleteTrigger}
            />
          }
        />
      ) : null}
    </FileDetailsContext.Provider>
  );
}
