import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { MediaFileDto } from "@/lib/api/media";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

vi.mock("@/app/content/files/actions", () => ({
  updateFileAltAction: vi.fn(),
  getFileDownloadUrlAction: vi.fn(),
  archiveFileAction: vi.fn(),
}));

const { FilesTable } = await import("./files-table");

const file = (overrides: Partial<MediaFileDto> = {}): MediaFileDto => ({
  id: "m-1",
  name: "Beach.png",
  status: "active",
  contentType: "image/png",
  byteSize: 1536,
  createdAt: "2026-11-24T10:00:00.000Z",
  image: { url: "https://cdn.test/beach.webp", alt: "A beach", width: 10, height: 10 },
  ...overrides,
});

beforeEach(() => {
  expect.hasAssertions();
});

describe("FilesTable", () => {
  it("has the five columns", () => {
    render(<FilesTable files={[file()]} canEdit t={en} locale="en" />);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["File name", "Alt text", "Type", "Size", "Date added"]);
  });

  it("renders a row with name in a bdi, alt text, type, size and a locale date", () => {
    render(<FilesTable files={[file()]} canEdit t={en} locale="en" />);

    const row = screen.getByRole("row", { name: /Beach\.png/ });
    const name = within(row).getByText("Beach.png");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
    expect(within(row).getByText("A beach").tagName).toBe("BDI");
    const cells = within(row).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("PNG");
    expect(cells[3]).toHaveTextContent("1.5 KB");
    expect(cells[4]).toHaveTextContent("Nov 24, 2026");
  });

  it("shows 'No alt text' when there is none, and the file icon for a non-image", () => {
    render(
      <FilesTable
        files={[
          file({ id: "m-2", name: "Terms.pdf", contentType: "application/pdf", image: null }),
        ]}
        canEdit
        t={en}
        locale="en"
      />,
    );

    const row = screen.getByRole("row", { name: /Terms\.pdf/ });
    expect(within(row).getByText("No alt text")).toBeInTheDocument();
    expect(within(row).queryByRole("img")).toBeNull();
    expect(row.querySelector("svg.lucide-file")).not.toBeNull();
  });

  it("renders in Arabic", () => {
    render(<FilesTable files={[file()]} canEdit t={ar} locale="ar" />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      ar.files.columns.name,
      ar.files.columns.alt,
      ar.files.columns.type,
      ar.files.columns.size,
      ar.files.columns.added,
    ]);
    expect(screen.getByRole("row", { name: /Beach\.png/ })).toHaveTextContent(ar.files.units.kb);
  });
});
