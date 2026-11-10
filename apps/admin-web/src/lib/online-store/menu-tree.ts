import type { MenuItem } from "@platform/storefront-content";

/**
 * The menu editor's tree (spec 2.7), pure and client-safe. Two levels: top-level items and their
 * children. `broken` and `targetTitle` come from the API's view and are never sent back.
 */
export type EditableItem = MenuItem & {
  readonly broken?: boolean;
  readonly targetTitle?: string | null;
  readonly children: readonly EditableItem[];
};

/** Adds at the top level, or as the last child of a TOP-LEVEL parent; any other parent is a no-op. */
export function addItem(
  items: readonly EditableItem[],
  item: EditableItem,
  parentId?: string,
): EditableItem[] {
  if (parentId === undefined) return [...items, item];
  return items.map((parent) =>
    parent.id === parentId ? { ...parent, children: [...parent.children, item] } : parent,
  );
}

/** Swaps the item with this id (at either level) for `next`. */
export function replaceItem(
  items: readonly EditableItem[],
  id: string,
  next: EditableItem,
): EditableItem[] {
  return items.map((item) =>
    item.id === id ? next : { ...item, children: replaceItem(item.children, id, next) },
  );
}

/** Removes the item with this id; a removed parent takes its children with it. */
export function removeItem(items: readonly EditableItem[], id: string): EditableItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) => ({ ...item, children: removeItem(item.children, id) }));
}

/** Applies `change` to the level (top level or one parent's children) that holds `id`. */
function atLevelOf(
  items: readonly EditableItem[],
  id: string,
  change: (level: readonly EditableItem[], index: number) => EditableItem[],
): EditableItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) return change(items, index);
  return items.map((item) => ({ ...item, children: atLevelOf(item.children, id, change) }));
}

/** Moves the item one place up (-1) or down (1) within its own level, clamped at the ends. */
export function moveItem(
  items: readonly EditableItem[],
  id: string,
  delta: -1 | 1,
): EditableItem[] {
  return atLevelOf(items, id, (level, index) => {
    const target = index + delta;
    if (target < 0 || target >= level.length) return [...level];
    const next = [...level];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    return next;
  });
}

/**
 * A drag-and-drop move: the item takes the place of `targetId`, which must be its sibling (same
 * level). Anything else leaves the tree unchanged, so a drop can never change an item's depth.
 */
export function moveItemTo(
  items: readonly EditableItem[],
  id: string,
  targetId: string,
): EditableItem[] {
  if (id === targetId) return [...items];
  return atLevelOf(items, id, (level, index) => {
    const target = level.findIndex((item) => item.id === targetId);
    if (target < 0) return [...level];
    const next = [...level];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    return next;
  });
}

/** The items as the API stores them: `{ id, label, link, children }` only. */
export function toMenuItems(items: readonly EditableItem[]): MenuItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    link: item.link,
    children: toMenuItems(item.children),
  }));
}

/** Where an item sits: its level (siblings, itself included), its index there, and its parent. */
export function locateItem(
  items: readonly EditableItem[],
  id: string,
): {
  readonly level: readonly EditableItem[];
  readonly index: number;
  readonly parent: EditableItem | null;
} | null {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) return { level: items, index, parent: null };
  for (const parent of items) {
    const child = parent.children.findIndex((item) => item.id === id);
    if (child >= 0) return { level: parent.children, index: child, parent };
  }
  return null;
}
