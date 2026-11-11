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
