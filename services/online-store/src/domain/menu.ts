import { isDefaultMenuHandle, type MenuItem } from "@platform/storefront-content";

/** Menus per shop, default menus included once saved (spec 2.2, Ruling 6). */
export const MENU_LIMIT = 50;

export interface MenuSnapshot {
  /** Null for a virtual default menu that has never been saved. */
  readonly id: string | null;
  readonly handle: string;
  readonly title: string;
  readonly items: readonly MenuItem[];
  readonly version: number;
  readonly updatedAt: Date | null;
  /** False until the first save inserts the row (an absent default menu is virtual). */
  readonly persisted: boolean;
}

export interface NewMenuInput {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly items: readonly MenuItem[];
  readonly now: Date;
}

/**
 * A navigation menu (spec 2.2). Handle, title and items are already validated by the use case
 * (`validateMenuItems`, `isMenuHandle`); the handle never changes after creation.
 */
export class Menu {
  private state: MenuSnapshot;

  private constructor(state: MenuSnapshot) {
    this.state = state;
  }

  static create(input: NewMenuInput): Menu {
    return new Menu({
      id: input.id,
      handle: input.handle,
      title: input.title,
      items: input.items,
      version: 0,
      updatedAt: input.now,
      persisted: false,
    });
  }

  static reconstitute(snapshot: MenuSnapshot): Menu {
    return new Menu(snapshot);
  }

  update(title: string, items: readonly MenuItem[], now: Date): void {
    this.state = { ...this.state, title, items, updatedAt: now };
  }

  snapshot(): MenuSnapshot {
    return this.state;
  }

  /** The version the row will carry after a successful save. */
  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }

  /** `main-menu` and `footer` cannot be deleted, only reset (spec 2.2). */
  get isDefault(): boolean {
    return isDefaultMenuHandle(this.state.handle);
  }
}
