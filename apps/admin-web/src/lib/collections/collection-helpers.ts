/** Members shown per page on the collection screen (the API's default page size). */
export const MEMBERS_PAGE_SIZE = 50;

/**
 * The Handle a title suggests: lowercase, spaces to `-`, everything outside `[a-z0-9-]` dropped, repeated and edge dashes trimmed.
 * An Arabic title therefore yields an empty handle that the merchant types themselves.
 */
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** `?membersPage=` — an integer ≥ 1; anything else (absent, 0, 2.5, "x", repeated) is page 1. */
export function parseMembersPage(value: string | readonly string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(page * MEMBERS_PAGE_SIZE)) {
    return 1;
  }
  return page;
}

/** The members API cursor: the index of the last member of the previous page. Page 1 has none. */
export function membersCursor(page: number): string | undefined {
  return page > 1 ? String((page - 1) * MEMBERS_PAGE_SIZE - 1) : undefined;
}
