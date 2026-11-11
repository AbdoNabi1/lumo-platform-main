import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  newSection,
  SECTION_TYPES,
  sectionDefinition,
  type KnownSection,
} from "@platform/storefront-content";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

vi.mock("@/app/online-store/navigation/actions", () => ({ searchLinkTargetsAction: vi.fn() }));
vi.mock("@/app/online-store/themes/actions", () => ({
  updateImageAltAction: vi.fn(),
  listLibraryImagesAction: vi.fn(),
}));
vi.mock("@/app/online-store/actions", () => ({ uploadOnlineStoreImageAction: vi.fn() }));
const { Harness, ID } = await import("./test-harness");

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(cleanup);

describe("SectionSettingsForm", () => {
  it.each(SECTION_TYPES.map((type) => [type]))(
    "%s renders every field of its definition from its defaults",
    (type) => {
      const section = newSection(type, ID) as KnownSection;
      const definition = sectionDefinition(type)!;
      const { container } = render(<Harness section={section} />);
      // Manual-only controls stay hidden while the source is "newest" / "all" (the defaults).
      const manualOnly = new Set(["featured_products:products", "collection_list:items"]);
      const visible = definition.fields.filter((field) => !manualOnly.has(`${type}:${field.key}`));
      for (const field of visible) {
        const label =
          en.onlineStoreSections.fields[field.key as keyof typeof en.onlineStoreSections.fields];
        expect(label, `label for ${field.key}`).toBeTypeOf("string");
        expect(screen.getAllByText(new RegExp(label)).length, field.key).toBeGreaterThan(0);
      }
      expect(container.querySelectorAll("input, select, textarea").length).toBeGreaterThan(0);
    },
  );

  it.each(SECTION_TYPES.map((type) => [type]))("%s also renders in Arabic", (type) => {
    const { container } = render(
      <Harness section={newSection(type, ID) as KnownSection} t={ar} locale="ar" />,
    );
    expect(container.querySelectorAll("input, select, textarea").length).toBeGreaterThan(0);
  });

  it("an announcement bar's errors are found under header.announcement", () => {
    render(
      <Harness
        section={newSection("announcement_bar", ID) as KnownSection}
        path="header.announcement"
        errors={{ "header.announcement.settings.text.ar": "too long" }}
      />,
    );
    expect(screen.getByText("too long")).toBeInTheDocument();
  });

  it("shows no problem alert for a clean section", () => {
    render(<Harness section={newSection("hero", ID) as KnownSection} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
