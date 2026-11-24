import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MediaFileDto } from "@/lib/api/media";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

vi.mock("@/app/content/files/actions", () => ({
  updateFileAltAction: vi.fn(),
  getFileDownloadUrlAction: vi.fn(),
  archiveFileAction: vi.fn(),
}));

const { FilesGrid } = await import("./files-grid");

const imageFile = (overrides: Partial<MediaFileDto> = {}): MediaFileDto => ({
  id: "m-1",
  name: "Beach.png",
  status: "active",
  contentType: "image/png",
  byteSize: 1536,
  createdAt: "2026-11-24T10:00:00.000Z",
  image: { url: "https://cdn.test/beach.webp", alt: "A beach", width: 10, height: 10 },
  ...overrides,
});

const document_ = (): MediaFileDto =>
  imageFile({
    id: "m-2",
    name: "Terms.pdf",
    contentType: "application/pdf",
    byteSize: 3 * 1024 * 1024,
    image: null,
  });

beforeEach(() => {
  expect.hasAssertions();
});

describe("FilesGrid", () => {
  it("shows a square thumbnail with its alt text, the name in a bdi, then type and size", () => {
    render(<FilesGrid files={[imageFile()]} canEdit t={en} locale="en" />);

    const tile = screen.getByRole("button", { name: /Beach\.png/ });
    expect(within(tile).getByRole("img", { name: "A beach" })).toHaveAttribute(
      "src",
      "https://cdn.test/beach.webp",
    );
    const name = within(tile).getByText("Beach.png");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
    expect(tile).toHaveTextContent("PNG · 1.5 KB");
    expect(tile.querySelector(".aspect-square")).not.toBeNull();
  });

  it("formats megabytes with one decimal", () => {
    render(
      <FilesGrid files={[imageFile({ byteSize: 2.5 * 1024 * 1024 })]} canEdit t={en} locale="en" />,
    );

    expect(screen.getByRole("button", { name: /Beach\.png/ })).toHaveTextContent("2.5 MB");
  });

  it("draws the file icon for a non-image", () => {
    render(<FilesGrid files={[document_()]} canEdit t={en} locale="en" />);

    const tile = screen.getByRole("button", { name: /Terms\.pdf/ });
    expect(within(tile).queryByRole("img")).toBeNull();
    expect(tile.querySelector("svg.lucide-file")).not.toBeNull();
    expect(tile).toHaveTextContent("PDF · 3.0 MB");
  });

  it("isolates a right-to-left file name", () => {
    render(<FilesGrid files={[imageFile({ name: "شاطئ.png" })]} canEdit t={en} locale="en" />);

    expect(screen.getByText("شاطئ.png").tagName).toBe("BDI");
  });

  it("renders in Arabic with Arabic units", () => {
    render(<FilesGrid files={[imageFile()]} canEdit t={ar} locale="ar" />);

    expect(screen.getByRole("list", { name: ar.files.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Beach\.png/ })).toHaveTextContent(ar.files.units.kb);
  });

  it("opens the details dialog when a tile is clicked", async () => {
    render(<FilesGrid files={[imageFile()]} canEdit t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: /Beach\.png/ }));

    expect(await within(document.body).findByRole("dialog")).toBeInTheDocument();
  });
});
