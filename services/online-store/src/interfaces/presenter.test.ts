import { describe, expect, it } from "vitest";
import { err, ok } from "@platform/types";
import { draftChanged, invalidContent, nothingToPublish } from "../domain/errors";
import { present } from "./presenter";

describe("present", () => {
  it("copies the CODE: prefix into body.code and maps the status", () => {
    expect(present(err(draftChanged()), 200)).toMatchObject({
      status: 409,
      body: { code: "DRAFT_CHANGED" },
    });
    expect(present(err(nothingToPublish()), 200)).toMatchObject({
      status: 409,
      body: { code: "NOTHING_TO_PUBLISH" },
    });
    expect(
      present(err(invalidContent([{ path: "brand.corners", code: "INVALID_VALUE" }])), 200),
    ).toMatchObject({
      status: 422,
      body: {
        code: "INVALID_CONTENT",
        fields: [{ field: "brand.corners", message: "INVALID_VALUE" }],
      },
    });
    expect(present(ok({ a: 1 }), 201)).toEqual({ status: 201, body: { a: 1 } });
  });
});
