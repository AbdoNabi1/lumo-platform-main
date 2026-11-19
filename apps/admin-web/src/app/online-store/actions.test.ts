// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ uploadOnlineStoreImage: vi.fn() }));
vi.mock("@/lib/api/online-store", () => api);
const { uploadOnlineStoreImageAction } = await import("./actions");

const IMAGE = { id: "img-1", url: "https://media.test/a.png", alt: null, width: 64, height: 64 };

function upload(type: string, purpose: string, name = "logo.png", bytes = [137, 80, 78, 71]) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  form.set("purpose", purpose);
  return form;
}

beforeEach(() => {
  api.uploadOnlineStoreImage.mockReset().mockResolvedValue({ outcome: "ok", data: IMAGE });
});

describe("uploadOnlineStoreImageAction", () => {
  it("refuses a JPEG favicon locally, without calling the API", async () => {
    expect(await uploadOnlineStoreImageAction(upload("image/jpeg", "favicon", "f.jpg"))).toEqual({
      status: "error",
      reason: "unsupported",
    });
    expect(api.uploadOnlineStoreImage).not.toHaveBeenCalled();
  });

  it("sends a PNG favicon's own bytes and content type (no re-encode) with one key", async () => {
    const result = await uploadOnlineStoreImageAction(upload("image/png", "favicon", "f.png"));
    expect(result).toEqual({ status: "ok", image: IMAGE });
    expect(api.uploadOnlineStoreImage).toHaveBeenCalledTimes(1);
    const input = api.uploadOnlineStoreImage.mock.calls[0]?.[0] as {
      bytes: Uint8Array;
      contentType: string;
      fileName: string;
      purpose: string;
      idempotencyKey: string;
    };
    expect(input.purpose).toBe("favicon");
    expect(input.contentType).toBe("image/png");
    expect(input.fileName).toBe("f.png");
    expect(Array.from(input.bytes)).toEqual([137, 80, 78, 71]);
    expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses an unknown purpose and a missing file before any request", async () => {
    expect(await uploadOnlineStoreImageAction(upload("image/png", "product"))).toEqual({
      status: "error",
      reason: "invalid_purpose",
    });
    const empty = new FormData();
    empty.set("purpose", "logo");
    expect(await uploadOnlineStoreImageAction(empty)).toEqual({
      status: "error",
      reason: "unsupported",
    });
    expect(api.uploadOnlineStoreImage).not.toHaveBeenCalled();
  });

  it.each([
    [{ outcome: "invalid", code: "BAD_DIMENSIONS", detail: {} }, "bad_dimensions"],
    [{ outcome: "invalid", code: "IMAGE_TOO_LARGE_DIMENSIONS", detail: {} }, "too_many_pixels"],
    [{ outcome: "invalid", code: "VALIDATION", detail: {} }, "invalid_purpose"],
    [{ outcome: "invalid", code: "INVALID_PURPOSE", detail: {} }, "invalid_purpose"],
    [{ outcome: "invalid", code: "SOMETHING_NEW", detail: {} }, "failed"],
    [{ outcome: "unauthorized" }, "forbidden"],
    [{ outcome: "unavailable" }, "unavailable"],
    [{ outcome: "too_large" }, "too_large"],
    [{ outcome: "unsupported" }, "unsupported"],
    [{ outcome: "conflict" }, "in_flight"],
    [{ outcome: "error", message: "Admin API responded with status 500" }, "failed"],
  ])("maps %j to the reason %s (never the server's text)", async (outcome, reason) => {
    api.uploadOnlineStoreImage.mockResolvedValue(outcome);
    expect(await uploadOnlineStoreImageAction(upload("image/png", "logo"))).toEqual({
      status: "error",
      reason,
    });
  });
});
