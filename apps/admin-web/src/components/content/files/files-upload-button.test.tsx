import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({ uploadFileAction: vi.fn() }));
const prepare = vi.hoisted(() => ({ prepareImage: vi.fn() }));
vi.mock("@/app/content/files/actions", () => actions);
vi.mock("@/lib/media/prepare-image", () => prepare);

const { FilesUploadButton } = await import("./files-upload-button");

beforeEach(() => {
  expect.hasAssertions();
  actions.uploadFileAction.mockReset();
  prepare.prepareImage.mockReset();
  prepare.prepareImage.mockImplementation(async (file: File) => ({ ok: true, file }));
  actions.uploadFileAction.mockResolvedValue({ status: "ok", image: { id: "m" } });
});

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
const input = () => screen.getByTestId("files-upload-input") as HTMLInputElement;
const pick = (...files: File[]) => fireEvent.change(input(), { target: { files } });
const sentName = (callIndex: number) =>
  (actions.uploadFileAction.mock.calls[callIndex]?.[0] as FormData).get("file") as File;

describe("FilesUploadButton", () => {
  it("is a multi-file input limited to the four image types, behind an Upload files button", () => {
    render(<FilesUploadButton t={en} />);

    expect(input()).toHaveAttribute("multiple");
    expect(input()).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/gif");
    const click = vi.spyOn(input(), "click");
    fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("uploads two files with two separate action calls, in order", async () => {
    render(<FilesUploadButton t={en} />);

    pick(png("a.png"), png("b.png"));

    await waitFor(() => expect(actions.uploadFileAction).toHaveBeenCalledTimes(2));
    expect(sentName(0).name).toBe("a.png");
    expect(sentName(1).name).toBe("b.png");
    expect(prepare.prepareImage).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("2 uploaded.")).toBeInTheDocument();
  });

  it("sends the prepared file, not the original", async () => {
    const prepared = new File([new Uint8Array([9])], "a.webp", { type: "image/webp" });
    prepare.prepareImage.mockResolvedValue({ ok: true, file: prepared });
    render(<FilesUploadButton t={en} />);

    pick(png("a.png"));

    await waitFor(() => expect(actions.uploadFileAction).toHaveBeenCalledTimes(1));
    expect(sentName(0)).toBe(prepared);
  });

  it("names a refused file with the reason, and still uploads the rest", async () => {
    prepare.prepareImage.mockImplementation(async (file: File) =>
      file.name === "huge.png" ? { ok: false, reason: "too_large" } : { ok: true, file },
    );
    render(<FilesUploadButton t={en} />);

    pick(png("huge.png"), png("ok.png"));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("huge.png").tagName).toBe("BDI");
    expect(alert).toHaveTextContent(`huge.png: ${en.productMedia.errorTooLarge}`);
    await waitFor(() => expect(actions.uploadFileAction).toHaveBeenCalledTimes(1));
    expect(sentName(0).name).toBe("ok.png");
    expect(await screen.findByText("1 uploaded.")).toBeInTheDocument();
  });

  it.each([
    ["too_large", en.productMedia.errorTooLarge],
    ["unsupported", en.productMedia.errorUnsupported],
    ["unavailable", en.productMedia.storageNotSetUp],
    ["failed", en.productMedia.errorFailed],
  ])("shows the %s reason from the action", async (reason, text) => {
    actions.uploadFileAction.mockResolvedValue({ status: "error", reason });
    render(<FilesUploadButton t={en} />);

    pick(png("a.png"));

    expect(await screen.findByRole("alert")).toHaveTextContent(`a.png: ${text}`);
  });

  it("treats a thrown action as a failed upload and keeps going", async () => {
    actions.uploadFileAction.mockRejectedValueOnce(new Error("network"));
    render(<FilesUploadButton t={en} />);

    pick(png("a.png"), png("b.png"));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.productMedia.errorFailed);
    await waitFor(() => expect(actions.uploadFileAction).toHaveBeenCalledTimes(2));
  });

  it("does nothing when the picker is dismissed with no files", () => {
    render(<FilesUploadButton t={en} />);

    pick();

    expect(prepare.prepareImage).not.toHaveBeenCalled();
    expect(actions.uploadFileAction).not.toHaveBeenCalled();
  });

  it("renders in Arabic", () => {
    render(<FilesUploadButton t={ar} />);

    expect(screen.getByRole("button", { name: ar.files.upload })).toBeInTheDocument();
  });
});
