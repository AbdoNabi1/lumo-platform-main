import {
  DEFAULT_MENU_HANDLES,
  isDefaultMenuHandle,
  isMenuHandle,
  MENU_TITLE_MAX,
  menuHandlesOf,
  normalizePlainText,
  RESERVED_MENU_HANDLES,
  validateMenuItems,
  type ContentIssue,
  type LocalizedText,
  type MenuItem,
  type PolicyType,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError } from "@platform/utils";
import { virtualDefaultMenu } from "../domain/default-menus";
import {
  invalidContent,
  invalidHandle,
  menuHandleTaken,
  menuInUse,
  menuLimit,
  menuNotFound,
  menuProtected,
  titleRequired,
  versionConflict,
} from "../domain/errors";
import { Menu, MENU_LIMIT, type MenuSnapshot } from "../domain/menu";
import type { OnlineStoreDeps } from "./deps";
import { inUnitOfWork } from "./guarded";
import { itemViews, loadTargets, type MenuItemView } from "./menu-resolution";
import type { LinkTargetMap } from "./ports";

/** The admin's menu (spec 2.2). `id` is null and `version` 0 for a default menu never saved. */
export interface MenuView {
  readonly id: string | null;
  readonly handle: string;
  readonly title: string;
  readonly isDefault: boolean;
  readonly version: number;
  readonly items: readonly MenuItemView[];
}

/** One row of the menu list (Ruling 29): at most five top-level labels. */
export interface MenuSummary {
  readonly id: string | null;
  readonly handle: string;
  readonly title: string;
  readonly itemCount: number;
  readonly isDefault: boolean;
  readonly topLabels: LocalizedText[];
}

const TOP_LABELS = 5;

/** The set policies, in policy order: the virtual footer links them, the resolver keeps them live. */
async function setPoliciesOf(
  deps: Pick<OnlineStoreDeps, "policies">,
  tenantId: string,
): Promise<readonly PolicyType[]> {
  const policies = await deps.policies.list(tenantId);
  return policies.filter((policy) => policy.isSet).map((policy) => policy.snapshot().type);
}

function labelCopy(label: LocalizedText): LocalizedText {
  return {
    ...(label.ar === undefined ? {} : { ar: label.ar }),
    ...(label.en === undefined ? {} : { en: label.en }),
  };
}

function viewOf(
  menu: MenuSnapshot,
  version: number,
  targets: LinkTargetMap,
  setPolicies: readonly PolicyType[],
): MenuView {
  return {
    id: menu.id,
    handle: menu.handle,
    title: menu.title,
    isDefault: isDefaultMenuHandle(menu.handle),
    version,
    items: itemViews(menu.items, targets, new Set(setPolicies)),
  };
}

function summaryOf(menu: MenuSnapshot): MenuSummary {
  return {
    id: menu.id,
    handle: menu.handle,
    title: menu.title,
    itemCount: menu.items.reduce((count, item) => count + 1 + item.children.length, 0),
    isDefault: isDefaultMenuHandle(menu.handle),
    topLabels: menu.items.slice(0, TOP_LABELS).map((item) => labelCopy(item.label)),
  };
}

interface MenuContent {
  readonly title: string;
  readonly items: readonly MenuItem[];
}

/** Title and items checked together, so one answer lists every problem (before any write). */
function readMenuContent(rawTitle: unknown, rawItems: unknown): Result<MenuContent, DomainError> {
  const issues: ContentIssue[] = [];
  const title = typeof rawTitle === "string" ? normalizePlainText(rawTitle) : "";
  if (title.length === 0) issues.push({ path: "title", code: "TITLE_REQUIRED" });
  else if (title.length > MENU_TITLE_MAX) issues.push({ path: "title", code: "TOO_LONG" });
  const items = validateMenuItems(rawItems);
  if (!items.ok) issues.push(...items.issues);
  if (items.ok && issues.length === 0) return ok({ title, items: items.value });
  const onlyTitleMissing = issues.length === 1 && issues[0]?.code === "TITLE_REQUIRED";
  return err(onlyTitleMissing ? titleRequired() : invalidContent(issues));
}

export class ListMenus {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<{ readonly menus: MenuSummary[] }, DomainError>> {
    const [saved, setPolicies] = await Promise.all([
      this.deps.menus.list(input.tenantId),
      setPoliciesOf(this.deps, input.tenantId),
    ]);
    const snapshots = saved.map((menu) => menu.snapshot());
    // The two defaults first, saved or virtual; then the rest, already ordered by handle.
    const defaults = DEFAULT_MENU_HANDLES.map(
      (handle) =>
        snapshots.find((menu) => menu.handle === handle) ??
        virtualDefaultMenu(handle, setPolicies).snapshot(),
    );
    const others = snapshots.filter((menu) => !isDefaultMenuHandle(menu.handle));
    return ok({ menus: [...defaults, ...others].map(summaryOf) });
  }
}

export class GetMenu {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly handle: string;
    readonly tenantId: string;
  }): Promise<Result<MenuView, DomainError>> {
    if (!isMenuHandle(input.handle)) return err(menuNotFound());
    const [saved, setPolicies] = await Promise.all([
      this.deps.menus.get(input.handle, input.tenantId),
      setPoliciesOf(this.deps, input.tenantId),
    ]);
    let menu: MenuSnapshot;
    if (saved !== null) menu = saved.snapshot();
    else if (isDefaultMenuHandle(input.handle))
      menu = virtualDefaultMenu(input.handle, setPolicies).snapshot();
    else return err(menuNotFound());
    // Strict: a catalogue failure surfaces here instead of every link looking broken (Ruling 26).
    const targets = await loadTargets(this.deps, menu.items, input.tenantId);
    return ok(viewOf(menu, menu.version, targets, setPolicies));
  }
}

export interface CreateMenuInput {
  readonly handle: string;
  readonly title: unknown;
  readonly items: unknown;
  readonly tenantId: string;
}

/**
 * Creates a menu (spec 2.2). Handle, title, items, the limit, the policies and the link targets
 * are all read before the unit of work, which only re-checks the handle and inserts: `run`
 * commits whenever the callback returns, and once it has, building the answer cannot fail.
 */
export class CreateMenu {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: CreateMenuInput): Promise<Result<MenuView, DomainError>> {
    const { handle, tenantId } = input;
    const reserved = (RESERVED_MENU_HANDLES as readonly string[]).includes(handle);
    if (!isMenuHandle(handle) || reserved) return err(invalidHandle());
    if (isDefaultMenuHandle(handle)) return err(menuHandleTaken());
    const content = readMenuContent(input.title, input.items);
    if (!content.ok) return content;
    // One row and one count, never every menu with its items (review M1).
    const [existing, customMenus] = await Promise.all([
      this.deps.menus.get(handle, tenantId),
      this.deps.menus.countCustom(tenantId),
    ]);
    if (existing !== null) return err(menuHandleTaken());
    // MENU_LIMIT caps custom menus: saving `main-menu` or `footer` never uses one up (review M2).
    // A soft cap: it counts outside the transaction, so two concurrent creates at 49 can both
    // pass and leave 51 custom menus. One over a limit of 50 is harmless; a lock is not worth it.
    if (customMenus >= MENU_LIMIT) return err(menuLimit());
    const [setPolicies, targets] = await Promise.all([
      setPoliciesOf(this.deps, tenantId),
      loadTargets(this.deps, content.value.items, tenantId),
    ]);
    const menu = Menu.create({
      id: this.deps.idGenerator.generate(),
      handle,
      title: content.value.title,
      items: content.value.items,
      now: this.deps.clock.now(),
    });
    const version = menu.nextVersion;
    let created: Result<MenuSnapshot, DomainError>;
    try {
      created = await this.deps.unitOfWork.run(async (tx) => {
        if ((await this.deps.menus.get(handle, tenantId, tx)) !== null) {
          return err(menuHandleTaken());
        }
        await this.deps.menus.save(menu, tenantId, tx);
        return ok(menu.snapshot());
      });
    } catch (error) {
      // Another request inserted this handle between the re-check and the insert (rolled back).
      if (error instanceof ConcurrencyError) return err(menuHandleTaken());
      throw error;
    }
    return created.ok ? ok(viewOf(created.value, version, targets, setPolicies)) : created;
  }
}

export interface UpdateMenuInput {
  readonly handle: string;
  readonly title: unknown;
  readonly items: unknown;
  readonly expectedVersion: number;
  readonly tenantId: string;
}

/**
 * Replaces a menu's title and items; for `main-menu` and `footer` the first save inserts the row
 * (an upsert, `expectedVersion` 0). A row inserted by another request first makes the insert
 * throw `ConcurrencyError`, answered as VERSION_CONFLICT (Review Focus 4).
 */
export class UpdateMenu {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: UpdateMenuInput): Promise<Result<MenuView, DomainError>> {
    const { handle, tenantId } = input;
    if (!isMenuHandle(handle)) return err(menuNotFound());
    const content = readMenuContent(input.title, input.items);
    if (!content.ok) return content;
    const { title, items } = content.value;
    const [setPolicies, targets] = await Promise.all([
      setPoliciesOf(this.deps, tenantId),
      loadTargets(this.deps, items, tenantId),
    ]);
    const now = this.deps.clock.now();
    const saved = await inUnitOfWork(this.deps, async (tx) => {
      const current = await this.deps.menus.get(handle, tenantId, tx);
      let menu: Menu;
      if (current !== null) {
        if (current.snapshot().version !== input.expectedVersion) return err(versionConflict());
        menu = current;
        menu.update(title, items, now);
      } else if (isDefaultMenuHandle(handle)) {
        if (input.expectedVersion !== 0) return err(versionConflict());
        // Never the virtual default itself: it has no id. The first save gets a fresh one.
        menu = Menu.create({ id: this.deps.idGenerator.generate(), handle, title, items, now });
      } else {
        return err(menuNotFound());
      }
      const version = menu.nextVersion;
      await this.deps.menus.save(menu, tenantId, tx);
      return ok({ snapshot: menu.snapshot(), version });
    });
    return saved.ok
      ? ok(viewOf(saved.value.snapshot, saved.value.version, targets, setPolicies))
      : saved;
  }
}

/**
 * Deletes a menu. The two defaults are protected; a menu the draft or the live theme shows is in
 * use. Both checks run before the only write.
 */
export class DeleteMenu {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly handle: string;
    readonly tenantId: string;
  }): Promise<Result<{ readonly handle: string }, DomainError>> {
    const { handle, tenantId } = input;
    if (!isMenuHandle(handle)) return err(menuNotFound());
    if (isDefaultMenuHandle(handle)) return err(menuProtected());
    return inUnitOfWork(this.deps, async (tx) => {
      const theme = (await this.deps.themes.get(tenantId, tx)).snapshot();
      const used = [
        ...menuHandlesOf(theme.draft),
        ...(theme.published === null ? [] : menuHandlesOf(theme.published)),
      ];
      if (used.includes(handle)) return err(menuInUse());
      const removed = await this.deps.menus.remove(handle, tenantId, tx);
      return removed ? ok({ handle }) : err(menuNotFound());
    });
  }
}
