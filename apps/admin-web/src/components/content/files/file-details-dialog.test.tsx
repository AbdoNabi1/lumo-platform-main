import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MediaFileDto } from "@/lib/api/media";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({
  updateFileAltAction: vi.fn(),
  getFileDownloadUrlAction: vi.fn(),
  archiveFileAction: vi.fn(),
}));
vi.mock("@/app/content/files/actions", () => actions);

const { FilesBrowser } = await import("./files-browser");
const { FilesGrid } = await import("./files-grid");

const body = () => within(document.body);

const FILE: MediaFileDto = {
  id: "m-1",
  name: "Beach.png",
  status: "active",
  contentType: "image/png",
  byteSize: 1536,
  createdAt: "2026-11-24T10:00:00.000Z",
  image: { url: "https://cdn.test/beach.webp", alt: "A beach", width: 10, height: 10 },
};

beforeEach(() => {
  expect.hasAssertions();
  actions.updateFileAltAction.mockReset();
  actions.getFileDownloadUrlAction.mockReset();
  actions.archiveFileAction.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function open(canEdit: boolean, file: MediaFileDto = FILE, t: Dictionary = en) {
  const locale = t === ar ? "ar" : "en";
  render(
    <FilesBrowser canEdit={canEdit} t={t} locale={locale}>
      <FilesGrid files={[file]} t={t} locale={locale} />
    </FilesBrowser>,
  );
  fireEvent.click(screen.getByRole("button", { name: new RegExp(file.name.replace(".", "\\.")) }));
  return body().findByRole("dialog");
}

describe("FileDetailsDialog — operator", () => {
  it("shows the preview, name, type, size and date, with every control", async () => {
    const dialog = await open(true);

    expect(within(dialog).getByRole("img", { name: "A beach" })).toHaveAttribute(
      "src",
      "https://cdn.test/beach.webp",
    );
    const title = body().getByRole("dialog", { name: "Beach.png" });
    expect(within(title).getAllByText("Beach.png")[0]!.tagName).toBe("BDI");
    expect(dialog).toHaveAccessibleDescription("PNG · 1.5 KB · Nov 24, 2026");
    expect(within(dialog).getByRole("textbox", { name: "Alt text" })).toHaveValue("A beach");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete file" })).toBeInTheDocument();
  });

  it("saves the alt text through the action and confirms", async () => {
    actions.updateFileAltAction.mockResolvedValue({ status: "success" });
    const dialog = await open(true);
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Alt text" }), {
      target: { value: "A sunny beach" },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(actions.updateFileAltAction).toHaveBeenCalledWith("m-1", "A sunny beach"),
    );
    expect(await within(dialog).findByText("Saved.")).toBeInTheDocument();
  });

  it("refuses an alt text over 512 characters without calling the action", async () => {
    const dialog = await open(true);

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Alt text" }), {
      target: { value: "x".repeat(513) },
    });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Alt text can be at most 512 characters.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(actions.updateFileAltAction).not.toHaveBeenCalled();
  });

  it("shows the action's refusal next to the alt text", async () => {
    actions.updateFileAltAction.mockResolvedValue({
      status: "error",
      message: "Nope",
      fieldErrors: { alt: "Alt refused" },
    });
    const dialog = await open(true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Alt text" }), {
      target: { value: "new" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Alt refused");
  });

  it("copies the image link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const dialog = await open(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://cdn.test/beach.webp"));
    expect(await within(dialog).findByText("Link copied.")).toBeInTheDocument();
  });

  it("downloads through the action and opens the signed URL", async () => {
    actions.getFileDownloadUrlAction.mockResolvedValue({
      status: "ok",
      url: "https://s.test/m-1?sig=1",
    });
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const dialog = await open(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));

    await waitFor(() => expect(actions.getFileDownloadUrlAction).toHaveBeenCalledWith("m-1"));
    await waitFor(() =>
      expect(openWindow).toHaveBeenCalledWith(
        "https://s.test/m-1?sig=1",
        "_blank",
        "noopener,noreferrer",
      ),
    );
  });

  it("shows a download failure and opens nothing", async () => {
    actions.getFileDownloadUrlAction.mockResolvedValue({ status: "error", message: "No link" });
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const dialog = await open(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No link");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("deleting closes the details dialog too", async () => {
    actions.archiveFileAction.mockResolvedValue({ status: "success" });
    const dialog = await open(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete file" }));
    const confirm = await body().findByRole("dialog", { name: "Delete file?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete file" }));

    await waitFor(() => expect(actions.archiveFileAction).toHaveBeenCalledWith("m-1"));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
  });

  it("has no preview or Copy link for a non-image", async () => {
    const dialog = await open(true, {
      ...FILE,
      name: "Terms.pdf",
      contentType: "application/pdf",
      image: null,
    });

    expect(within(dialog).getByText("No preview available")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("renders in Arabic", async () => {
    const dialog = await open(true, FILE, ar);

    expect(
      within(dialog).getByRole("textbox", { name: ar.files.details.altLabel }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: ar.files.details.copyLink }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: ar.files.details.delete }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: en.files.details.copyLink })).toBeNull();
  });
});

describe("FileDetailsDialog — viewer or unknown role (canEdit=false)", () => {
  it("shows no Upload, Save, Download, Delete or editable alt text, but keeps Copy link", async () => {
    await open(false);

    const page = body();
    expect(page.getByRole("dialog", { name: "Beach.png" })).toBeInTheDocument();
    expect(page.queryByRole("button", { name: "Save" })).toBeNull();
    expect(page.queryByRole("button", { name: "Download" })).toBeNull();
    expect(page.queryByRole("button", { name: "Delete file" })).toBeNull();
    expect(page.queryByRole("button", { name: "Upload files" })).toBeNull();
    expect(page.queryByRole("textbox")).toBeNull();
    expect(page.getByText("A beach", { selector: "p" })).toBeInTheDocument();
    expect(page.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("shows 'No alt text' read-only when there is none", async () => {
    await open(false, { ...FILE, image: { ...FILE.image!, alt: null } });

    expect(body().getByText("No alt text")).toBeInTheDocument();
    expect(body().queryByRole("textbox")).toBeNull();
  });
});
