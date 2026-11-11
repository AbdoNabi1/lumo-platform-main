/** Fixed class lookups (Ruling 16): a merchant value only ever picks one, never becomes a class. */
export const GRID_COLUMNS: Readonly<Record<2 | 3 | 4, string>> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
};

/** The grid classes for a column count; anything but 2, 3 or 4 is 2. */
export function columnsClass(n: number): string {
  return n === 3 || n === 4 ? GRID_COLUMNS[n] : GRID_COLUMNS[2];
}

export const BUTTON_CLASS: Readonly<Record<"primary" | "secondary", string>> = {
  primary:
    "bg-primary text-primary-foreground inline-flex min-h-10 items-center justify-center rounded-md px-5 py-2 text-sm font-medium hover:opacity-90",
  secondary:
    "border-border bg-background text-foreground inline-flex min-h-10 items-center justify-center rounded-md border px-5 py-2 text-sm font-medium hover:bg-muted",
};

/** The dark layer over a hero picture: one fixed class set per overlay step (0 to 80). */
export const OVERLAY_CLASSES: Readonly<Record<0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80, string>> =
  {
    0: "after:bg-foreground after:absolute after:inset-0 after:opacity-0",
    10: "after:bg-foreground after:absolute after:inset-0 after:opacity-10",
    20: "after:bg-foreground after:absolute after:inset-0 after:opacity-20",
    30: "after:bg-foreground after:absolute after:inset-0 after:opacity-30",
    40: "after:bg-foreground after:absolute after:inset-0 after:opacity-40",
    50: "after:bg-foreground after:absolute after:inset-0 after:opacity-50",
    60: "after:bg-foreground after:absolute after:inset-0 after:opacity-60",
    70: "after:bg-foreground after:absolute after:inset-0 after:opacity-70",
    80: "after:bg-foreground after:absolute after:inset-0 after:opacity-80",
  };

/** The overlay classes for a value; anything but 0, 10 … 80 is no overlay. */
export function overlayClass(n: number): string {
  return (OVERLAY_CLASSES as Readonly<Record<number, string>>)[n] ?? OVERLAY_CLASSES[0];
}

export const HERO_HEIGHTS: Readonly<Record<"small" | "medium" | "large", string>> = {
  small: "h-60 md:h-80",
  medium: "h-80 md:h-[30rem]",
  large: "h-[28rem] md:h-[40rem]",
};

export const ANNOUNCEMENT_STYLES: Readonly<Record<"accent" | "primary" | "dark", string>> = {
  accent: "bg-accent text-accent-foreground",
  primary: "bg-primary text-primary-foreground",
  dark: "bg-foreground text-background",
};

export const ALIGN_CLASSES: Readonly<Record<"start" | "center", string>> = {
  start: "items-start text-start",
  center: "items-center text-center",
};
