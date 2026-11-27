// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  uploadProductImage: vi.fn(),
  updateMediaAlt: vi.fn(),
  archiveMediaFile: vi.fn(),
  fetchMediaDownloadUrl: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const cookieLocale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/media", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieLocale.value === undefined ? undefined : { value: cookieLocale.value }),
  }),
}));

const { archiveFileAction, getFileDownloadUrlAction, updateFileAltAction, uploadFileAction } =
  await import("./actions");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATH = "/content/files";
const IMAGE = { id: "m-1", url: "https://cdn.test/m-1.webp", alt: null, width: 4, height: 4 };

function upload(file: File | string | null): FormData {
  const data = new FormData();
  if (file !== null) data.append("file", file);
  return data;
}
const png = (name = "a.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

beforeEach(() => {
  expect.hasAssertions();
  cookieLocale.value = undefined;
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("uploadFileAction", () => {
  it("sends the bytes, type and name with a fresh idempotency key and revalidates the page", async () => {
    api.uploadProductImage.mockResolvedValue({ outcome: "ok", image: IMAGE });

    const result = await uploadFileAction(upload(png("Beach.png")));

    expect(result).toEqual({ status: "ok", image: IMAGE });
    const input = api.uploadProductImage.mock.calls[0]![0];
    expect(input.fileName).toBe("Beach.png");
    expect(input.contentType).toBe("image/png");
    expect([...input.bytes]).toEqual([1, 2, 3]);
    expect(input.idempotencyKey).toMatch(UUID);
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it("uses a different idempotency key for every file", async () => {
    api.uploadProductImage.mockResolvedValue({ outcome: "ok", image: IMAGE });

    await uploadFileAction(upload(png("a.png")));
    await uploadFileAction(upload(png("b.png")));

    expect(api.uploadProductImage).toHaveBeenCalledTimes(2);
    const keys = api.uploadProductImage.mock.calls.map((call) => call[0].idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it.each([
    ["unavailable", "unavailable"],
    ["too_large", "too_large"],
    ["unsupported", "unsupported"],
    ["invalid", "failed"],
    ["conflict", "failed"],
    ["unauthorized", "failed"],
    ["error", "failed"],
  ])("maps the %s outcome to %s and still revalidates", async (outcome, reason) => {
    api.uploadProductImage.mockResolvedValue({ outcome, message: "x", code: "c", detail: null });

    expect(await uploadFileAction(upload(png()))).toEqual({ status: "error", reason });
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it("refuses a file over 8 MiB before calling the API, and does not revalidate", async () => {
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });

    expect(await uploadFileAction(upload(big))).toEqual({ status: "error", reason: "too_large" });
    expect(api.uploadProductImage).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly 8 MiB", async () => {
    api.uploadProductImage.mockResolvedValue({ outcome: "ok", image: IMAGE });
    const exact = new File([new Uint8Array(8 * 1024 * 1024)], "x.png", { type: "image/png" });

    expect((await uploadFileAction(upload(exact))).status).toBe("ok");
  });

  it("refuses a missing, text or empty file as unsupported without calling the API", async () => {
    expect(await uploadFileAction(upload(null))).toEqual({
      status: "error",
      reason: "unsupported",
    });
    expect(await uploadFileAction(upload("not a file"))).toEqual({
      status: "error",
      reason: "unsupported",
    });
    expect(await uploadFileAction(upload(new File([], "e.png", { type: "image/png" })))).toEqual({
      status: "error",
      reason: "unsupported",
    });
    expect(api.uploadProductImage).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateFileAltAction", () => {
  it("saves the trimmed alt with a fresh key and revalidates", async () => {
    api.updateMediaAlt.mockResolvedValue({ outcome: "ok", data: {} });

    expect(await updateFileAltAction("m-1", "  A beach  ")).toEqual({ status: "success" });
    expect(api.updateMediaAlt).toHaveBeenCalledWith("m-1", "A beach", expect.stringMatching(UUID));
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it("clears the alt with null when it is blank", async () => {
    api.updateMediaAlt.mockResolvedValue({ outcome: "ok", data: {} });

    await updateFileAltAction("m-1", "   ");

    expect(api.updateMediaAlt).toHaveBeenCalledWith("m-1", null, expect.any(String));
  });

  it("accepts 512 characters and refuses 513 before the API, without revalidating", async () => {
    api.updateMediaAlt.mockResolvedValue({ outcome: "ok", data: {} });

    expect((await updateFileAltAction("m-1", "x".repeat(512))).status).toBe("success");
    api.updateMediaAlt.mockClear();
    revalidatePath.mockClear();

    const refused = await updateFileAltAction("m-1", "x".repeat(513));
    expect(refused).toEqual({
      status: "error",
      message: en.files.details.altTooLong,
      fieldErrors: { alt: en.files.details.altTooLong },
    });
    expect(api.updateMediaAlt).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a blank id without calling the API", async () => {
    expect((await updateFileAltAction("", "x")).status).toBe("error");
    expect(api.updateMediaAlt).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates even when the API refuses", async () => {
    api.updateMediaAlt.mockResolvedValue({ outcome: "forbidden" });

    expect(await updateFileAltAction("m-1", "x")).toEqual({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });
});

describe("archiveFileAction", () => {
  it("archives with a fresh key, revalidates, and reports success", async () => {
    api.archiveMediaFile.mockResolvedValue({ outcome: "ok", data: { mediaAssetId: "m-1" } });

    expect(await archiveFileAction("m-1")).toEqual({ status: "success" });
    expect(api.archiveMediaFile).toHaveBeenCalledWith("m-1", expect.stringMatching(UUID));
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it.each([
    [
      { outcome: "conflict", message: "Archived", code: "BUSINESS_RULE" },
      en.files.delete.alreadyDeleted,
    ],
    [
      { outcome: "conflict", message: "In flight", code: "IDEMPOTENCY_IN_FLIGHT" },
      en.formErrors.conflict,
    ],
    [{ outcome: "conflict", message: "In flight" }, en.formErrors.conflict],
    [{ outcome: "not_found" }, en.formErrors.notFound],
    [{ outcome: "forbidden" }, en.formErrors.forbidden],
    [{ outcome: "unauthorized" }, en.formErrors.unauthorized],
    [{ outcome: "error", message: "boom" }, en.formErrors.unexpected],
    [{ outcome: "invalid", message: "bad", fields: [] }, en.formErrors.unexpected],
  ])("maps %j to its message and still revalidates", async (outcome, message) => {
    api.archiveMediaFile.mockResolvedValue(outcome);

    expect(await archiveFileAction("m-1")).toEqual({ status: "error", message, fieldErrors: {} });
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it("answers in Arabic from the locale cookie", async () => {
    cookieLocale.value = "ar";
    api.archiveMediaFile.mockResolvedValue({
      outcome: "conflict",
      message: "x",
      code: "BUSINESS_RULE",
    });

    expect(await archiveFileAction("m-1")).toMatchObject({
      message: ar.files.delete.alreadyDeleted,
    });
  });

  it("refuses a blank id without calling the API or revalidating", async () => {
    expect((await archiveFileAction("")).status).toBe("error");
    expect(api.archiveMediaFile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("getFileDownloadUrlAction", () => {
  it("returns the signed https URL and never revalidates (a read)", async () => {
    api.fetchMediaDownloadUrl.mockResolvedValue({
      outcome: "ok",
      url: "https://storage.test/m-1?sig=1",
    });

    expect(await getFileDownloadUrlAction("m-1")).toEqual({
      status: "ok",
      url: "https://storage.test/m-1?sig=1",
    });
    expect(api.fetchMediaDownloadUrl).toHaveBeenCalledWith("m-1");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a non-http URL", async () => {
    api.fetchMediaDownloadUrl.mockResolvedValue({ outcome: "ok", url: "javascript:alert(1)" });

    expect(await getFileDownloadUrlAction("m-1")).toEqual({
      status: "error",
      message: en.files.details.downloadFailed,
    });
  });

  it.each([
    [{ outcome: "unauthorized" }, en.formErrors.forbidden],
    [{ outcome: "not_found" }, en.formErrors.notFound],
    [{ outcome: "error", message: "x" }, en.formErrors.unexpected],
  ])("maps %j to a message", async (outcome, message) => {
    api.fetchMediaDownloadUrl.mockResolvedValue(outcome);

    expect(await getFileDownloadUrlAction("m-1")).toEqual({ status: "error", message });
  });

  it("refuses a blank id", async () => {
    expect((await getFileDownloadUrlAction("")).status).toBe("error");
    expect(api.fetchMediaDownloadUrl).not.toHaveBeenCalled();
  });
});
