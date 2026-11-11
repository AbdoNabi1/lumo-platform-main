"use client";

import {
  memo,
  useId,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { EllipsisIcon, EyeIcon, EyeOffIcon, PlusIcon } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@platform/ui";
import {
  HOMEPAGE_SECTIONS_MAX,
  isKnownSection,
  sectionDefinition,
  sectionHeading,
  type Section,
  type SectionPlacement,
  type SectionType,
  type ThemeDocument,
} from "@platform/storefront-content";
import type { OnlineStoreImageDto, ThemeTargetsDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import { newItemId } from "@/lib/online-store/new-item-id";
import { sectionProblems } from "@/lib/online-store/section-problems";
import {
  addSection,
  canAddSection,
  duplicateSection,
  findSection,
  moveSection,
  removeSection,
  setSectionHidden,
} from "@/lib/online-store/section-tree";
import type { Dictionary } from "@/messages/en";
import { FooterPanel, HeaderPanel, type FieldErrors, type MenuChoice } from "../customize-panels";
import { AddSectionDialog } from "./add-section-dialog";
import { SECTION_ICON_COMPONENTS } from "./section-icons";

/** What the editor can ask of the tree from outside: put keyboard focus back on a row. */
export interface SectionTreeHandle {
  focusRow(id: string): void;
}

/** Where focus goes once the next render lands: a row's select button, or an Add button. */
type FocusTarget = { readonly row: string } | "add" | "addAnnouncement";

export interface SectionTreePanelProps {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly doc: ThemeDocument;
  readonly targets: ThemeTargetsDto | null;
  readonly images: Readonly<Record<string, OnlineStoreImageDto>>;
  /** Field errors of the last save, by document path: a row whose path has one shows the dot. */
  readonly errors: FieldErrors;
  readonly selectedId: string | null;
  readonly disabled: boolean;
  readonly menus: readonly MenuChoice[];
  readonly onSelect: (id: string | null) => void;
  readonly onUpdate: (change: (doc: ThemeDocument) => ThemeDocument) => void;
  readonly handleRef?: Ref<SectionTreeHandle>;
}

const fill = (template: string, name: string) => template.replace("{name}", name);

const hasErrorAt = (errors: FieldErrors, path: string) =>
  Object.keys(errors).some((key) => key === path || key.startsWith(`${path}.`));

/** A row's title: the first heading, else the type's name (the "unsupported" label for others). */
export function sectionTitle(t: Dictionary, locale: Locale, section: Section): string {
  if (!isKnownSection(section)) return t.onlineStoreSections.unsupported;
  const heading = sectionHeading(section, locale);
  return heading !== null && heading.trim() !== ""
    ? heading
    : (sectionDefinition(section.type)?.labels[locale] ?? t.onlineStoreSections.unsupported);
}

interface RowActions {
  readonly move: (id: string, delta: -1 | 1) => void;
  readonly duplicate: (id: string) => void;
  readonly askRemove: (id: string) => void;
  readonly menuActed: { current: boolean };
}

/** The ⋯ menu of one row (portalled by the ui kit). Memoised: it only re-renders when it changes. */
const RowMenu = memo(function RowMenu({
  s,
  id,
  title,
  disabled,
  isAnnouncement,
  first,
  last,
  canDuplicate,
  actions,
}: {
  readonly s: Dictionary["onlineStoreSections"];
  readonly id: string;
  readonly title: string;
  readonly disabled: boolean;
  readonly isAnnouncement: boolean;
  readonly first: boolean;
  readonly last: boolean;
  readonly canDuplicate: boolean;
  readonly actions: { readonly current: RowActions };
}) {
  const act = (run: (a: RowActions) => void) => () => {
    const a = actions.current;
    a.menuActed.current = true;
    run(a);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label={fill(s.more, title)}
        >
          <EllipsisIcon aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const a = actions.current;
          if (!a.menuActed.current) return;
          a.menuActed.current = false;
          event.preventDefault();
        }}
      >
        {isAnnouncement ? null : (
          <>
            <DropdownMenuItem disabled={first} onSelect={act((a) => a.move(id, -1))}>
              {s.moveUp}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={act((a) => a.move(id, 1))}>
              {s.moveDown}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canDuplicate} onSelect={act((a) => a.duplicate(id))}>
              {s.duplicate}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onSelect={act((a) => a.askRemove(id))}>{s.remove}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/**
 * Online Store → Customize → Sections (spec 3.5): the Header, Template and Footer groups. Every
 * edit is a pure tree operation sent through the editor's `update`, so autosave, conflicts and
 * replay stay Part 1's. Focus never falls to the page: after a move it stays on the moved row,
 * after a remove it goes to the next row (else the previous one, else Add), after a duplicate to
 * the copy. The target is decided together with the new tree and applied after the render.
 */
export function SectionTreePanel({
  t,
  locale,
  doc,
  targets,
  images,
  errors,
  selectedId,
  disabled,
  menus,
  onSelect,
  onUpdate,
  handleRef,
}: SectionTreePanelProps) {
  const s = t.onlineStoreSections;
  const idBase = useId();
  const [adding, setAdding] = useState<SectionPlacement | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<FocusTarget | null>(null);
  /** An action that moves focus itself: the menu must not hand it back to its trigger. */
  const menuActed = useRef(false);

  const control = (key: string) => (element: HTMLElement | null) => {
    if (element === null) controls.current.delete(key);
    else controls.current.set(key, element);
  };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyFocus = () => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const key = typeof target === "string" ? target : `${target.row}:select`;
    const focus = () => controls.current.get(key)?.focus();
    focus();
    // A menu that has just closed may still hold focus for one more tick; take it back after.
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (document.activeElement !== controls.current.get(key)) focus();
    }, 0);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  // After every tree change (and a selection change, for "Back to sections"). A passive effect,
  // not a layout one: a closing menu or dialog still traps focus until its own cleanup has run.
  useEffect(applyFocus, [doc, selectedId]);

  useImperativeHandle(handleRef, () => ({
    focusRow: (id) => controls.current.get(`${id}:select`)?.focus(),
  }));

  const sections = doc.homepage.sections;
  const announcement = doc.header.announcement;

  const move = (id: string, delta: -1 | 1) => {
    if (moveSection(doc, id, delta) === doc) return; // already at that end
    pendingFocus.current = { row: id };
    onUpdate((d) => moveSection(d, id, delta));
  };

  const duplicate = (id: string) => {
    const copyId = newItemId();
    if (duplicateSection(doc, id, copyId) === doc) return;
    pendingFocus.current = { row: copyId };
    onUpdate((d) => duplicateSection(d, id, copyId));
    onSelect(copyId);
  };

  const remove = (id: string) => {
    const found = findSection(doc, id);
    if (found === null) return;
    if (found.place === "announcement") {
      pendingFocus.current = "addAnnouncement";
    } else {
      const neighbour = sections[found.place + 1] ?? sections[found.place - 1] ?? null;
      pendingFocus.current = neighbour === null ? "add" : { row: neighbour.id };
    }
    onUpdate((d) => removeSection(d, id));
    if (selectedId === id) onSelect(null);
  };

  const add = (type: SectionType) => {
    const id = newItemId();
    if (canAddSection(doc, type) !== "ok") return;
    onUpdate((d) => addSection(d, type, id));
    onSelect(id);
  };

  /** Latest closures behind a stable ref, so a row's memoised menu does not re-render per edit. */
  const actions = useRef<RowActions>({ move, duplicate, askRemove: setRemoving, menuActed });
  actions.current = { move, duplicate, askRemove: setRemoving, menuActed };

  const onRowKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(id, event.key === "ArrowUp" ? -1 : 1);
  };

  const renderRow = (section: Section, path: string, index: number | null) => {
    const known = isKnownSection(section);
    const definition = known ? sectionDefinition(section.type) : null;
    const Icon = definition === null ? null : SECTION_ICON_COMPONENTS[definition.icon];
    const title = sectionTitle(t, locale, section);
    const problem =
      (known && sectionProblems(section, targets, images).length > 0) || hasErrorAt(errors, path);
    const dotId = `${idBase}-${section.id}-dot`;
    const isAnnouncement = index === null;
    const canDuplicate =
      !isAnnouncement && canAddSection(doc, section.type as SectionType) === "ok";
    return (
      <li
        key={section.id}
        data-section-row={section.id}
        className="border-border bg-card flex items-center gap-1 rounded-xl border ps-2"
      >
        <button
          ref={control(`${section.id}:select`)}
          type="button"
          disabled={disabled}
          aria-current={selectedId === section.id ? "true" : undefined}
          aria-describedby={problem ? dotId : undefined}
          className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-2 text-start text-sm focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60"
          onClick={() => onSelect(section.id)}
          onKeyDown={(event) => onRowKey(event, section.id)}
        >
          {Icon === null ? null : (
            <Icon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
          )}
          <bdi dir="auto" className="min-w-0 truncate font-medium">
            {title}
          </bdi>
          {section.hidden ? <Badge variant="neutral">{s.hiddenBadge}</Badge> : null}
        </button>
        {problem ? (
          <span
            id={dotId}
            role="img"
            aria-label={s.hasProblem}
            title={s.hasProblem}
            className="bg-destructive size-2 shrink-0 rounded-full"
          />
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-pressed={section.hidden}
          aria-label={fill(section.hidden ? s.show : s.hide, title)}
          onClick={() => onUpdate((d) => setSectionHidden(d, section.id, !section.hidden))}
        >
          {section.hidden ? (
            <EyeOffIcon aria-hidden="true" className="size-4" />
          ) : (
            <EyeIcon aria-hidden="true" className="size-4" />
          )}
        </Button>
        <RowMenu
          s={s}
          id={section.id}
          title={title}
          disabled={disabled}
          isAnnouncement={isAnnouncement}
          first={index === 0}
          last={index === sections.length - 1}
          canDuplicate={canDuplicate}
          actions={actions}
        />
      </li>
    );
  };

  const removingFound = removing === null ? null : findSection(doc, removing);
  const removingTitle =
    removingFound === null ? "" : sectionTitle(t, locale, removingFound.section);
  const panelProps = { t, locale, doc, update: onUpdate, disabled, errors, menus };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${idBase}-header`} className="flex flex-col gap-3">
        <h3 id={`${idBase}-header`} className="text-sm font-semibold">
          {s.header}
        </h3>
        {announcement === null ? (
          <Button
            ref={control("addAnnouncement")}
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            className="justify-start"
            onClick={() => setAdding("header")}
          >
            <PlusIcon aria-hidden="true" />
            {s.addAnnouncement}
          </Button>
        ) : (
          <ul className="flex flex-col gap-2">
            {renderRow(announcement, "header.announcement", null)}
          </ul>
        )}
        <HeaderPanel {...panelProps} />
      </section>

      <section aria-labelledby={`${idBase}-template`} className="flex flex-col gap-3">
        <h3 id={`${idBase}-template`} className="text-sm font-semibold">
          {s.template}
        </h3>
        <ul className="flex flex-col gap-2">
          {sections.map((section, index) =>
            renderRow(section, `homepage.sections.${index}`, index),
          )}
        </ul>
        <Button
          ref={control("add")}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          className="justify-start"
          onClick={() => setAdding("homepage")}
        >
          <PlusIcon aria-hidden="true" />
          {s.addSection}
        </Button>
        {sections.length >= HOMEPAGE_SECTIONS_MAX ? (
          <p className="text-muted-foreground text-xs">{s.limitReached}</p>
        ) : null}
      </section>

      <section aria-labelledby={`${idBase}-footer`} className="flex flex-col gap-3">
        <h3 id={`${idBase}-footer`} className="text-sm font-semibold">
          {s.footer}
        </h3>
        <FooterPanel {...panelProps} />
      </section>

      <AddSectionDialog
        t={t}
        locale={locale}
        open={adding !== null}
        onOpenChange={(open) => {
          if (!open) setAdding(null);
        }}
        doc={doc}
        placement={adding ?? "homepage"}
        onAdd={add}
      />
      <Dialog open={removing !== null} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            // The next row, or Add, takes focus with the new tree; the trigger is gone.
            event.preventDefault();
            applyFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {s.remove} <bdi dir="auto">{removingTitle}</bdi>
            </DialogTitle>
            <DialogDescription>{s.confirmRemove}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRemoving(null)}>
              {s.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (removing !== null) remove(removing);
                setRemoving(null);
              }}
            >
              {s.confirmRemoveButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
