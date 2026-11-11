import type { ContentIssue } from "@platform/storefront-content";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@platform/utils";

/** Ruling 9: every specific code is the message prefix; the presenter copies it into `body.code`. */
export const CODE_PATTERN = /^([A-Z][A-Z_]+):/;

export const versionConflict = () =>
  new ConflictError("VERSION_CONFLICT: This was changed in another window. Reload to continue.");
export const draftChanged = () =>
  new ConflictError("DRAFT_CHANGED: The draft changed after it was previewed. Preview it again.");
export const nothingToPublish = () =>
  new BusinessRuleError("NOTHING_TO_PUBLISH: The draft has no unpublished changes.");
export const releaseNotFound = () => new NotFoundError("RELEASE_NOT_FOUND: No such release.");
export const passwordRequired = () =>
  new ValidationError("PASSWORD_REQUIRED: Set a password before locking the store.", [
    { field: "password", message: "PASSWORD_REQUIRED" },
  ]);
export const imageNotFound = (field: string) =>
  new ValidationError("IMAGE_NOT_FOUND: The image does not exist in this store.", [
    { field, message: "IMAGE_NOT_FOUND" },
  ]);
/**
 * Ruling 6: references the save found missing, each at its path (images first). The top code is
 * the first issue's, so a single kind of miss reads as that code.
 */
export const referencesNotFound = (issues: readonly ContentIssue[]) =>
  new ValidationError(
    `${issues[0]?.code ?? "TARGET_NOT_FOUND"}: The highlighted item no longer exists in this store.`,
    issues.map((issue) => ({ field: issue.path, message: issue.code })),
  );
export const invalidContent = (issues: readonly ContentIssue[]) => {
  const top = issues.find((issue) => issue.path === "");
  const code = top?.code ?? "INVALID_CONTENT";
  return new ValidationError(
    `${code}: Check the highlighted fields.`,
    issues.map((issue) => ({ field: issue.path, message: issue.code })),
  );
};
export const policyNotFound = () => new NotFoundError("POLICY_NOT_FOUND: This policy is not set.");
/** A menu reaches storage only with an id; a virtual default menu is given one by `Menu.create`. */
export const menuNeedsId = () =>
  new BusinessRuleError("MENU_ID_REQUIRED: A menu needs an id before it can be saved.");
export const menuNotFound = () => new NotFoundError("MENU_NOT_FOUND: No such menu.");
export const menuHandleTaken = () =>
  new ConflictError("MENU_HANDLE_TAKEN: Another menu already uses this handle.");
export const menuProtected = () =>
  new BusinessRuleError("MENU_PROTECTED: The main menu and the footer menu cannot be deleted.");
export const menuInUse = () =>
  new BusinessRuleError("MENU_IN_USE: The theme shows this menu. Choose another menu first.");
export const menuLimit = () =>
  new BusinessRuleError("MENU_LIMIT: This store has the most menus it can have.");
export const invalidHandle = () =>
  new ValidationError("INVALID_HANDLE: Use lowercase letters, digits and single hyphens.", [
    { field: "handle", message: "INVALID_HANDLE" },
  ]);
export const titleRequired = () =>
  new ValidationError("TITLE_REQUIRED: Give the menu a title.", [
    { field: "title", message: "TITLE_REQUIRED" },
  ]);
