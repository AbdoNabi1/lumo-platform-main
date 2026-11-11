import { describe, expect, it } from "vitest";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@platform/utils";
import {
  CODE_PATTERN,
  draftChanged,
  imageNotFound,
  invalidContent,
  invalidHandle,
  menuHandleTaken,
  menuInUse,
  menuLimit,
  menuNotFound,
  menuProtected,
  nothingToPublish,
  passwordRequired,
  referencesNotFound,
  releaseNotFound,
  titleRequired,
  versionConflict,
} from "./errors";

describe("online-store errors (Ruling 9: the code is the message prefix)", () => {
  it.each([
    [versionConflict(), ConflictError, "VERSION_CONFLICT"],
    [draftChanged(), ConflictError, "DRAFT_CHANGED"],
    [nothingToPublish(), BusinessRuleError, "NOTHING_TO_PUBLISH"],
    [releaseNotFound(), NotFoundError, "RELEASE_NOT_FOUND"],
    [passwordRequired(), ValidationError, "PASSWORD_REQUIRED"],
    [imageNotFound("shareImageId"), ValidationError, "IMAGE_NOT_FOUND"],
    [menuNotFound(), NotFoundError, "MENU_NOT_FOUND"],
    [menuHandleTaken(), ConflictError, "MENU_HANDLE_TAKEN"],
    [menuProtected(), BusinessRuleError, "MENU_PROTECTED"],
    [menuInUse(), BusinessRuleError, "MENU_IN_USE"],
    [menuLimit(), BusinessRuleError, "MENU_LIMIT"],
    [invalidHandle(), ValidationError, "INVALID_HANDLE"],
    [titleRequired(), ValidationError, "TITLE_REQUIRED"],
  ])("%s carries its code as the message prefix", (error, type, code) => {
    expect(error).toBeInstanceOf(type);
    expect(CODE_PATTERN.exec(error.message)?.[1]).toBe(code);
  });

  it("names the offending field for password and image errors", () => {
    expect(passwordRequired().fields).toEqual([
      { field: "password", message: "PASSWORD_REQUIRED" },
    ]);
    expect(imageNotFound("brand.logoId").fields).toEqual([
      { field: "brand.logoId", message: "IMAGE_NOT_FOUND" },
    ]);
    expect(invalidHandle().fields).toEqual([{ field: "handle", message: "INVALID_HANDLE" }]);
    expect(titleRequired().fields).toEqual([{ field: "title", message: "TITLE_REQUIRED" }]);
  });

  it("invalidContent uses the document-level issue code, else INVALID_CONTENT, and lists every issue", () => {
    const top = invalidContent([
      { path: "brand.colors.text", code: "BAD_COLOR" },
      { path: "", code: "DOCUMENT_TOO_LARGE" },
    ]);
    expect(CODE_PATTERN.exec(top.message)?.[1]).toBe("DOCUMENT_TOO_LARGE");
    expect(top.fields).toEqual([
      { field: "brand.colors.text", message: "BAD_COLOR" },
      { field: "", message: "DOCUMENT_TOO_LARGE" },
    ]);
    const plain = invalidContent([{ path: "footer.note.ar", code: "TOO_LONG" }]);
    expect(CODE_PATTERN.exec(plain.message)?.[1]).toBe("INVALID_CONTENT");
  });

  it("referencesNotFound puts the first code first and keeps every field", () => {
    const error = referencesNotFound([
      { path: "homepage.sections.0.settings.image", code: "IMAGE_NOT_FOUND" },
      { path: "homepage.sections.1.settings.collection", code: "TARGET_NOT_FOUND" },
    ]);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe(
      "IMAGE_NOT_FOUND: The highlighted item no longer exists in this store.",
    );
    expect(error.fields).toEqual([
      { field: "homepage.sections.0.settings.image", message: "IMAGE_NOT_FOUND" },
      { field: "homepage.sections.1.settings.collection", message: "TARGET_NOT_FOUND" },
    ]);
    const targets = referencesNotFound([{ path: "a.b", code: "TARGET_NOT_FOUND" }]);
    expect(CODE_PATTERN.exec(targets.message)?.[1]).toBe("TARGET_NOT_FOUND");
  });
});
