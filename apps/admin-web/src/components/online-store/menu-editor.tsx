"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, Input, Label } from "@platform/ui";
import {
  isMenuHandle,
  MENU_TITLE_MAX,
  normalizePlainText,
  pickText,
  RESERVED_MENU_HANDLES,
  validateMenuItems,
  type ContentIssue,
} from "@platform/storefront-content";
import {
  createMenuAction,
  deleteMenuAction,
  saveMenuAction,
  type MenuSaveState,
} from "@/app/online-store/navigation/actions";
import type { MenuDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import { linkTargetText, menuDisplayTitle, menuIssueCopy } from "@/lib/online-store/menu-copy";
import {
  addItem,
  locateItem,
  moveItem,
  moveItemTo,
  removeItem,
  replaceItem,
  toMenuItems,
  type EditableItem,
} from "@/lib/online-store/menu-tree";
import type { Dictionary } from "@/messages/en";
import { MenuItemDialog } from "./menu-item-dialog";
import { SaveStatus } from "./save-status";

type DialogState =
  | { readonly mode: "add"; readonly parentId?: string; readonly parentLabel?: string }
  | { readonly mode: "edit"; readonly item: EditableItem };

/** A row control focus can return to after the tree re-renders (review I-1). */
type Control = "edit" | "up" | "down" | "row";
/** Where focus goes once the next render lands: one row's control, or the Add button. */
type FocusTarget = { readonly id: string; readonly control: Control } | "add";

const fill = (template: string, label: string) => template.replace("{label}", label);

/** The row an issue path belongs to: `items.2`, `items.2.children.0`; null for the whole menu. */
function rowOf(path: string): string | null {
  return /^items\.\d+(?:\.children\.\d+)?/.exec(path)?.[0] ?? null;
}

const snapshot = (title: string, items: readonly EditableItem[]) =>
  JSON.stringify({ title, items: toMenuItems(items) });

/**
 * Online Store → Navigation → one menu (spec 2.7). A two-level tree: rows show the label and what
 * it links to (a policy, home and search named in the admin's language; a removed target flagged),
 * with Edit, Add sub-item (top level only), Move up / Move down (or drag within a level) and Delete.
 * Nothing is sent until Save, which sends the whole tree with the version it was loaded at; the
 * shared `validateMenuItems` runs first, so a menu the API would refuse is never sent. A 409 keeps
 * the edits and says why. `menu === null` is a new menu, with its handle.
 */
export function MenuEditor({
  t,
  locale,
  menu,
  canEdit,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly menu: MenuDto | null;
  readonly canEdit: boolean;
}) {
  const n = t.onlineStoreNavigation;
  const isNew = menu === null;
  const initialTitle = menu === null ? "" : menuDisplayTitle(t, menu);
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [titleTouched, setTitleTouched] = useState(false);
  const [items, setItems] = useState<readonly EditableItem[]>(menu?.items ?? []);
  const [saved, setSaved] = useState({ title: initialTitle, items: menu?.items ?? [] });
  const [version, setVersion] = useState(menu?.version ?? 0);
  const [status, setStatus] = useState<MenuSaveState | null>(null);
  const [serverErrors, setServerErrors] = useState<Readonly<Record<string, string>>>({});
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const dragging = useRef<string | null>(null);
  // Review I-1: a Delete or a move re-renders (and in a browser, relocates) the row that held
  // focus. The control to focus next is decided with the new tree, then applied after the render.
  const controls = useRef(new Map<string, HTMLElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const control = (id: string, which: Control) => (element: HTMLElement | null) => {
    const key = `${id}:${which}`;
    if (element === null) controls.current.delete(key);
    else controls.current.set(key, element);
  };
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") addButton.current?.focus();
    else controls.current.get(`${target.id}:${target.control}`)?.focus();
  }, [items]);

  const dirty = snapshot(title, items) !== snapshot(saved.title, saved.items);
  const menuItems = toMenuItems(items);

  // The shared rules first (the API runs the same ones): issues by row, and the menu-wide ones.
  const checked = validateMenuItems(menuItems);
  const issues: readonly ContentIssue[] = checked.ok ? [] : checked.issues;
  const rowErrors = new Map<string, string[]>();
  const menuErrors: string[] = [];
  const note = (path: string, message: string) => {
    const row = rowOf(path);
    const list = row === null ? menuErrors : (rowErrors.get(row) ?? []);
    if (!list.includes(message)) list.push(message);
    if (row !== null) rowErrors.set(row, list);
  };
  for (const issue of issues) note(issue.path, menuIssueCopy(t, issue.code, issue.path));
  for (const [field, message] of Object.entries(serverErrors)) {
    if (field.startsWith("items")) note(field, message);
  }
  // The title as the server stores and measures it (`normalizePlainText`, review M-9).
  const normalizedTitle = normalizePlainText(title);
  const titleError =
    serverErrors["title"] ??
    (normalizedTitle === "" && titleTouched
      ? n.titleRequired
      : normalizedTitle.length > MENU_TITLE_MAX
        ? t.onlineStorePreferences.tooLong
        : undefined);
  const handleOk =
    isMenuHandle(handle) && !(RESERVED_MENU_HANDLES as readonly string[]).includes(handle);
  const handleError =
    serverErrors["handle"] ?? (handle !== "" && !handleOk ? n.handleError : undefined);
  const canSave =
    canEdit &&
    !pending &&
    issues.length === 0 &&
    normalizedTitle !== "" &&
    normalizedTitle.length <= MENU_TITLE_MAX &&
    (!isNew || handleOk) &&
    (isNew || dirty);

  /** Every edit clears the last answer: its field errors point at the tree as it was. */
  const edit = (next: readonly EditableItem[], focus: FocusTarget | null = null) => {
    pendingFocus.current = focus;
    setItems(next);
    setServerErrors({});
    setStatus(null);
  };

  /** Keeps focus on the moved item: the pressed arrow, or the other one when it is now disabled. */
  const move = (id: string, delta: -1 | 1) => {
    const next = moveItem(items, id, delta);
    const place = locateItem(next, id);
    let focus: Control = delta === -1 ? "up" : "down";
    if (place !== null) {
      const last = place.level.length - 1;
      if (focus === "up" && place.index === 0) focus = last > 0 ? "down" : "row";
      if (focus === "down" && place.index === last) focus = last > 0 ? "up" : "row";
    }
    edit(next, { id, control: focus });
  };

  /** Focus goes to the next row, else the previous one, else the parent, else Add menu item. */
  const remove = (id: string) => {
    const place = locateItem(items, id);
    const neighbour = place?.level[place.index + 1] ?? place?.level[place.index - 1] ?? null;
    const target = neighbour ?? place?.parent ?? null;
    edit(removeItem(items, id), target === null ? "add" : { id: target.id, control: "edit" });
  };

  /** A drop on a row of another level changes nothing, so it is not an edit. */
  const drop = (from: string, onto: string) => {
    const source = locateItem(items, from);
    if (source === null || from === onto || !source.level.some((item) => item.id === onto)) return;
    edit(moveItemTo(items, from, onto));
  };

  const openDialog = (state: DialogState) => {
    setDialogKey((k) => k + 1);
    setDialog(state);
  };

  const applyResult = (result: MenuSaveState | undefined) => {
    if (result === undefined) return; // a redirect: the page is changing
    setStatus(result);
    if (result.status === "error") {
      setServerErrors(result.fieldErrors);
      return;
    }
    if ("menu" in result) {
      const savedTitle = menuDisplayTitle(t, result.menu);
      setTitle(savedTitle);
      setItems(result.menu.items);
      setSaved({ title: savedTitle, items: result.menu.items });
      setVersion(result.menu.version);
      setServerErrors({});
    }
  };

  /**
   * Runs one server action. A call that never answers (offline, or the action itself crashed)
   * rejects: it gets our generic copy, never silence, and the buttons come back (review M-2).
   * Next's own redirect after create and delete is rethrown, so it still navigates.
   */
  const run = async (call: () => Promise<MenuSaveState | undefined>) => {
    setPending(true);
    setStatus(null);
    try {
      applyResult(await call());
    } catch (error) {
      unstable_rethrow(error);
      setStatus({ status: "error", message: t.formErrors.unexpected, fieldErrors: {} });
    } finally {
      setPending(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    await run(() =>
      menu === null
        ? createMenuAction({ handle, title: normalizedTitle, items: menuItems })
        : saveMenuAction({
            handle: menu.handle,
            title: normalizedTitle,
            items: menuItems,
            expectedVersion: version,
          }),
    );
  };

  const discard = () => {
    setTitle(saved.title);
    setItems(saved.items);
    setServerErrors({});
    setStatus(null);
  };

  const deleteMenu = async () => {
    if (menu === null || !window.confirm(n.confirmDelete)) return;
    await run(() => deleteMenuAction(menu.handle));
  };

  const labelText = (item: EditableItem) => pickText(item.label, locale) ?? "";

  const renderRows = (level: readonly EditableItem[], depth: 1 | 2, parentPath: string) => (
    <ul
      data-level={depth}
      className={depth === 1 ? "flex flex-col gap-2" : "ms-6 mt-2 flex flex-col gap-2"}
    >
      {level.map((item, index) => {
        const path = `${parentPath}.${index}`;
        const label = labelText(item);
        const errors = rowErrors.get(path) ?? [];
        const errorsId = errors.length === 0 ? undefined : `menu-row-${item.id}-errors`;
        return (
          <li
            key={item.id}
            draggable={canEdit}
            onDragStart={(e) => {
              e.stopPropagation();
              dragging.current = item.id;
              // Firefox starts no drag from a non-link element without data (review M-3).
              if (e.dataTransfer) {
                e.dataTransfer.setData("text/plain", item.id);
                e.dataTransfer.effectAllowed = "move";
              }
            }}
            onDragOver={(e) => {
              if (dragging.current !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const from = dragging.current;
              dragging.current = null;
              if (from !== null) drop(from, item.id);
            }}
            onDragEnd={() => {
              dragging.current = null;
            }}
          >
            <div
              ref={control(item.id, "row")}
              tabIndex={-1}
              className="border-border bg-card flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
            >
              {canEdit ? (
                <GripVerticalIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-4 cursor-grab"
                />
              ) : null}
              <bdi dir="auto" className="min-w-0 font-medium">
                {label}
              </bdi>
              {item.broken === true ? (
                <Badge variant="destructive">{n.broken}</Badge>
              ) : (
                <Badge variant="neutral">
                  <bdi dir="auto">{linkTargetText(t, locale, item.link, item.targetTitle)}</bdi>
                </Badge>
              )}
              {canEdit ? (
                <div className="ms-auto flex flex-wrap items-center gap-1">
                  <Button
                    ref={control(item.id, "edit")}
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={fill(n.editLabel, label)}
                    aria-describedby={errorsId}
                    onClick={() => openDialog({ mode: "edit", item })}
                  >
                    {n.edit}
                  </Button>
                  {depth === 1 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={fill(n.addSubItemUnder, label)}
                      onClick={() =>
                        openDialog({ mode: "add", parentId: item.id, parentLabel: label })
                      }
                    >
                      {n.addSubItem}
                    </Button>
                  ) : null}
                  <Button
                    ref={control(item.id, "up")}
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={fill(n.moveUp, label)}
                    disabled={index === 0}
                    onClick={() => move(item.id, -1)}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                  </Button>
                  <Button
                    ref={control(item.id, "down")}
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={fill(n.moveDown, label)}
                    disabled={index === level.length - 1}
                    onClick={() => move(item.id, 1)}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={fill(n.deleteLabel, label)}
                    onClick={() => remove(item.id)}
                  >
                    {n.delete}
                  </Button>
                </div>
              ) : null}
            </div>
            {errorsId === undefined ? null : (
              <div id={errorsId} className="text-destructive mt-1 flex flex-col text-xs">
                {errors.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            )}
            {depth === 1 && item.children.length > 0
              ? renderRows(item.children, 2, `${path}.children`)
              : null}
          </li>
        );
      })}
    </ul>
  );

  const field = (
    id: string,
    label: string,
    error: string | undefined,
    input: ReactNode,
    help?: string,
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {help === undefined ? null : <p className="text-muted-foreground text-xs">{help}</p>}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? null : (
        <p role="note" className="text-muted-foreground text-sm">
          {n.readOnly}
        </p>
      )}
      <Card>
        <CardContent className="flex flex-col gap-4">
          {field(
            "menu-title",
            n.menuTitle,
            titleError,
            <Input
              id="menu-title"
              dir="auto"
              value={title}
              maxLength={MENU_TITLE_MAX}
              disabled={!canEdit}
              aria-invalid={titleError === undefined ? undefined : true}
              aria-describedby={titleError === undefined ? undefined : "menu-title-error"}
              onChange={(e) => {
                setTitle(e.currentTarget.value);
                setTitleTouched(true);
                setServerErrors({});
                setStatus(null);
              }}
            />,
          )}
          {isNew ? (
            field(
              "menu-handle",
              n.handle,
              handleError,
              <Input
                id="menu-handle"
                dir="ltr"
                value={handle}
                maxLength={60}
                disabled={!canEdit}
                aria-invalid={handleError === undefined ? undefined : true}
                aria-describedby={handleError === undefined ? undefined : "menu-handle-error"}
                onChange={(e) => {
                  setHandle(e.currentTarget.value);
                  setServerErrors({});
                  setStatus(null);
                }}
              />,
              n.handleHelp,
            )
          ) : (
            <p className="text-muted-foreground text-sm">
              {n.handle}: <bdi dir="ltr">{menu.handle}</bdi>
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{n.noItems}</p>
          ) : (
            renderRows(items, 1, "items")
          )}
          {canEdit ? (
            <Button
              ref={addButton}
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => openDialog({ mode: "add" })}
            >
              {n.addItem}
            </Button>
          ) : null}
        </CardContent>
      </Card>
      {menuErrors.length > 0 ? (
        <div id="menu-issues" className="text-destructive flex flex-col gap-1 text-sm">
          <p className="font-medium">{n.fixFirst}</p>
          <ul className="list-inside list-disc">
            {[...new Set(menuErrors)].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {status === null ? null : <SaveStatus t={t} state={status} />}
      {canEdit && (dirty || isNew) ? (
        <div className="bg-card border-border sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
          {dirty ? <p className="text-sm font-medium">{n.unsaved}</p> : null}
          <div className="ms-auto flex gap-2">
            {dirty ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={discard}>
                {n.discard}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={!canSave}
              loading={pending}
              aria-describedby={menuErrors.length > 0 ? "menu-issues" : undefined}
              onClick={() => void save()}
            >
              {pending ? n.saving : n.save}
            </Button>
          </div>
        </div>
      ) : null}
      {canEdit && menu !== null && !menu.isDefault ? (
        <Button
          type="button"
          variant="destructive"
          className="self-start"
          disabled={pending}
          onClick={() => void deleteMenu()}
        >
          {n.deleteMenu}
        </Button>
      ) : null}
      {dialog === null ? null : (
        <MenuItemDialog
          key={dialogKey}
          t={t}
          locale={locale}
          title={
            dialog.mode === "edit"
              ? n.editItem
              : dialog.parentLabel === undefined
                ? n.addItem
                : fill(n.addSubItemUnder, dialog.parentLabel)
          }
          item={dialog.mode === "edit" ? dialog.item : null}
          onCancel={() => setDialog(null)}
          onDone={(next) => {
            edit(
              dialog.mode === "edit"
                ? replaceItem(items, dialog.item.id, next)
                : addItem(items, next, dialog.parentId),
            );
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
