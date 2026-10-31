import { describe, expect, it } from "vitest";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@platform/utils";
import {
  CODE_PATTERN,
  draftChanged,
  imageNotFound,
  invalidContent,
  nothingToPublish,
  passwordRequired,
  releaseNotFound,
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
});
