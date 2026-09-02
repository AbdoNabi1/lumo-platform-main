import { describe, expect, it } from "vitest";
import type { MutationResult } from "./client";
import { toFormState, type FormErrorDictionary } from "./mutation";

const t: FormErrorDictionary = {
  unauthorized: "Sign in to continue.",
  forbidden: "Your account doesn't have permission to do this.",
  notFound: "That record couldn't be found.",
  conflict: "That didn't go through — try again.",
  invalid: "Check the highlighted fields.",
  unexpected: "Something went wrong. Try again.",
};

describe("toFormState", () => {
  it("maps ok to success", () => {
    const result: MutationResult<unknown> = { outcome: "ok", data: { id: "1" } };
    expect(toFormState(result, t)).toEqual({ status: "success" });
  });

  it("maps unauthorized to the dictionary message, no field errors", () => {
    const result: MutationResult<unknown> = { outcome: "unauthorized" };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: t.unauthorized,
      fieldErrors: {},
    });
  });

  it("maps forbidden to the dictionary message, no field errors", () => {
    const result: MutationResult<unknown> = { outcome: "forbidden" };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: t.forbidden,
      fieldErrors: {},
    });
  });

  it("maps not_found to the dictionary message, no field errors", () => {
    const result: MutationResult<unknown> = { outcome: "not_found" };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: t.notFound,
      fieldErrors: {},
    });
  });

  it("maps conflict to the API's own message, not a dictionary lookup", () => {
    const result: MutationResult<unknown> = {
      outcome: "conflict",
      message: "This record is already being edited.",
    };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: "This record is already being edited.",
      fieldErrors: {},
    });
  });

  it("maps error to the dictionary's unexpected message", () => {
    const result: MutationResult<unknown> = { outcome: "error", message: "boom" };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: t.unexpected,
      fieldErrors: {},
    });
  });

  it("maps invalid to fieldErrors keyed by field, plus the generic invalid message", () => {
    const result: MutationResult<unknown> = {
      outcome: "invalid",
      message: "Invalid input",
      fields: [
        { field: "sku", message: "must not be empty" },
        { field: "name", message: "must not be empty" },
      ],
    };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: t.invalid,
      fieldErrors: { sku: "must not be empty", name: "must not be empty" },
    });
  });

  it("routes a field issue with an empty field into the top-level message instead of dropping it", () => {
    const result: MutationResult<unknown> = {
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "", message: "This SKU is already taken." }],
    };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: "This SKU is already taken.",
      fieldErrors: {},
    });
  });

  it("handles a mix of field-scoped and top-level issues", () => {
    const result: MutationResult<unknown> = {
      outcome: "invalid",
      message: "Invalid input",
      fields: [
        { field: "sku", message: "must not be empty" },
        { field: "", message: "This SKU is already taken." },
      ],
    };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: "This SKU is already taken.",
      fieldErrors: { sku: "must not be empty" },
    });
  });

  it("falls back to the generic invalid message when there are no field issues at all", () => {
    const result: MutationResult<unknown> = { outcome: "invalid", message: "Invalid input", fields: [] };
    expect(toFormState(result, t)).toEqual({
      status: "error",
      message: t.invalid,
      fieldErrors: {},
    });
  });
});
