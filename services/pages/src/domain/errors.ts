import type { ContentIssue } from "@platform/storefront-content";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@platform/utils";

/** Every specific code is the message prefix; the presenter copies it into `body.code` (Ruling 24). */
export const CODE_PATTERN = /^([A-Z][A-Z_]+):/;

export const pageNotFound = () => new NotFoundError("PAGE_NOT_FOUND: Page not found");
export const versionConflict = () =>
  new ConflictError(
    "VERSION_CONFLICT: This page was changed in another window. Reload to continue.",
  );
export const pageArchived = () =>
  new BusinessRuleError("PAGE_ARCHIVED: An archived page cannot be edited.");
export const routePathTaken = (routePath: string) =>
  new ConflictError(`ROUTE_PATH_TAKEN: Page for route "${routePath}" already exists`);
export const invalidContent = (issues: readonly ContentIssue[]) =>
  new ValidationError(
    "INVALID_CONTENT: Check the highlighted fields.",
    issues.map((issue) => ({ field: issue.path, message: issue.code })),
  );
