import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  IMAGE_ALT_MAX,
  newSection,
  type KnownSection,
  type TestimonialsSettings,
} from "@platform/storefront-content";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  searchLinkTargetsAction: vi.fn(),
  updateImageAltAction: vi.fn(),
  listLibraryImagesAction: vi.fn(),
  uploadOnlineStoreImageAction: vi.fn(),
}));
vi.mock("@/app/online-store/navigation/actions", () => ({
  searchLinkTargetsAction: actions.searchLinkTargetsAction,
}));
vi.mock("@/app/online-store/themes/actions", () => ({
  updateImageAltAction: actions.updateImageAltAction,
  listLibraryImagesAction: actions.listLibraryImagesAction,
}));
vi.mock("@/app/online-store/actions", () => ({
  uploadOnlineStoreImageAction: actions.uploadOnlineStoreImageAction,
}));
const { Harness, ID } = await import("./test-harness");

const f = en.onlineStoreSections.fields;
const items = en.onlineStoreSections.items;
const opt = en.onlineStoreSections.options;
const img = en.onlineStoreSections.image;

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
});

// No user-event in this workspace: these helpers do what a person does (focus, then act).
const click = (el: HTMLElement) => {
  el.focus();
  fireEvent.click(el);
};
const type = (el: HTMLElement, text: string) => {
  el.focus();
  fireEvent.change(el, { target: { value: text } });
};
const leave = (el: HTMLElement) => {
  el.focus();
  act(() => el.blur());
};
const choose = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

const testimonials = (count: number): KnownSection => {
  const base = newSection("testimonials", ID);
  const first = (base.settings as TestimonialsSettings).items[0]!;
  return {
    ...base,
    settings: { ...base.settings, items: Array.from({ length: count }, () => first) },
  } as KnownSection;
};
const withSettings = (section: KnownSection, patch: Record<string, unknown>): KnownSection =>
  ({ ...section, settings: { ...section.settings, ...patch } }) as KnownSection;

describe("generated fields", () => {
  it("labels, counters and limits come from the definition (hero heading /80)", () => {
    render(<Harness section={newSection("hero", ID)} />);
    expect(screen.getAllByText(/\/\s*80/)).not.toHaveLength(0);
    expect(screen.getByLabelText(f.overlay)).toHaveAttribute("max", "80");
    expect(screen.getByLabelText(f.overlay)).toHaveAttribute("step", "10");
    expect(screen.getByLabelText(`${f.overlay} value`)).toHaveAttribute("type", "number");
  });

  it("three options are segmented buttons; seven are a select", () => {
    render(<Harness section={newSection("hero", ID)} />);
    const height = screen.getByRole("radiogroup", { name: f.height });
    expect(within(height).getAllByRole("radio")).toHaveLength(3);
    expect(within(height).getByRole("radio", { name: opt.medium })).toBeChecked();
    cleanup();
    render(<Harness section={newSection("features", ID)} />);
    const icon = screen.getAllByLabelText(f.icon)[0]!;
    expect(icon.tagName).toBe("SELECT");
    expect(within(icon).getAllByRole("option")).toHaveLength(7);
    expect(screen.queryByRole("radiogroup", { name: f.icon })).toBeNull();
  });

  it("choosing a segment stores the option", () => {
    const onChange = vi.fn();
    render(<Harness section={newSection("hero", ID)} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: opt.large }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ height: "large" }));
  });

  it("item fields have ids unique per section and item, wired to aria-describedby/aria-invalid", () => {
    render(
      <Harness
        section={testimonials(2)}
        errors={{
          "homepage.sections.0.settings.items.0.quote.ar": "x",
          "homepage.sections.0.settings.items.1.quote.ar": "y",
        }}
      />,
    );
    const invalid = screen
      .getAllByLabelText(/Quote/)
      .filter((el) => el.getAttribute("aria-invalid") === "true");
    expect(invalid).toHaveLength(2);
    const [a, b] = invalid as [HTMLElement, HTMLElement];
    expect(a.getAttribute("aria-describedby")).not.toBe(b.getAttribute("aria-describedby"));
    expect(a).toHaveAccessibleDescription(/x/);
    expect(b).toHaveAccessibleDescription(/y/);
  });

  it("two forms on one page never share an id", () => {
    render(
      <>
        <Harness section={newSection("hero", ID)} />
        <Harness section={newSection("hero", ID)} path="homepage.sections.1" />
      </>,
    );
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("removing an item moves focus to the next item's first field", async () => {
    render(<Harness section={newSection("features", ID)} />);
    click(screen.getByRole("button", { name: "Remove item 2" }));
    const second = screen.getByRole("group", { name: "Item 2" });
    const icon = within(second).getAllByLabelText(f.icon)[0]!;
    expect(icon).toHaveValue("returns");
    expect(document.activeElement).toBe(icon);
  });

  it("removing the last item focuses the previous one; removing the only one focuses Add", async () => {
    const section = withSettings(newSection("collection_list", ID), {
      source: "manual",
      items: [
        { collection: null, image: null },
        { collection: null, image: null },
      ],
    });
    render(<Harness section={section} />);
    click(screen.getByRole("button", { name: "Remove item 2" }));
    const first = screen.getByRole("group", { name: "Item 1" });
    expect(first.contains(document.activeElement)).toBe(true);
    click(screen.getByRole("button", { name: "Remove item 1" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: items.add }));
  });

  it("Move up/down keeps focus on the moved item's control", async () => {
    const onChange = vi.fn();
    render(<Harness section={newSection("features", ID)} onChange={onChange} />);
    click(screen.getByRole("button", { name: "Move item 1 down" }));
    const moved = onChange.mock.lastCall![0].items as { icon: string }[];
    expect(moved.map((i) => i.icon)).toEqual(["shipping", "cod", "returns"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move item 2 down" }));
    click(screen.getByRole("button", { name: "Move item 2 up" }));
    // Back at the top its Move up is disabled, so focus stays with the moved item on Move down.
    expect(screen.getByRole("button", { name: "Move item 1 up" })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move item 1 down" }));
  });

  it("moving an item to the end lands focus on the control that is still enabled", async () => {
    render(<Harness section={newSection("features", ID)} />);
    click(screen.getByRole("button", { name: "Move item 2 down" }));
    // The moved item is now last: its Move down is disabled, so focus goes to its Move up.
    expect(screen.getByRole("button", { name: "Move item 3 down" })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move item 3 up" }));
  });

  it("Remove is disabled at the minimum; Add at the maximum", () => {
    render(<Harness section={testimonials(1)} />);
    expect(screen.getByRole("button", { name: "Remove item 1" })).toBeDisabled();
    expect(screen.getByText(items.minItems)).toBeInTheDocument();
    cleanup();
    render(<Harness section={testimonials(8)} />);
    expect(screen.getByRole("button", { name: items.add })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove item 1" })).toBeEnabled();
  });

  it("Add appends an item built from the descriptors", async () => {
    const onChange = vi.fn();
    render(<Harness section={testimonials(1)} onChange={onChange} />);
    click(screen.getByRole("button", { name: items.add }));
    const next = onChange.mock.lastCall![0].items as unknown[];
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ quote: {}, author: "", rating: 0 });
  });

  it("the phone field normalises on blur with the package rule", async () => {
    const onChange = vi.fn();
    render(<Harness section={newSection("whatsapp_cta", ID)} onChange={onChange} />);
    type(screen.getByLabelText(f.phone), "010 0123 4567");
    leave(document.activeElement as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phone: "201001234567" }));
    expect(screen.getByLabelText(f.phone)).toHaveValue("+201001234567");
    expect(screen.queryByText(en.onlineStoreSections.errors.invalidPhone)).toBeNull();
  });

  it("the phone field flags a bad number on blur, and not an empty one", async () => {
    render(<Harness section={newSection("whatsapp_cta", ID)} />);
    type(screen.getByLabelText(f.phone), "12");
    leave(document.activeElement as HTMLElement);
    expect(screen.getByText(en.onlineStoreSections.errors.invalidPhone)).toBeInTheDocument();
    expect(screen.getByLabelText(f.phone)).toHaveAttribute("aria-invalid", "true");
    type(screen.getByLabelText(f.phone), "");
    leave(document.activeElement as HTMLElement);
    expect(screen.queryByText(en.onlineStoreSections.errors.invalidPhone)).toBeNull();
    expect(screen.getByText(en.onlineStoreSections.phone.hint)).toBeInTheDocument();
  });

  it("a number typed out of range is clamped on blur", async () => {
    const onChange = vi.fn();
    render(<Harness section={newSection("hero", ID)} onChange={onChange} />);
    const box = screen.getByLabelText(`${f.overlay} value`);
    type(box, "");
    type(box, "200");
    leave(document.activeElement as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ overlay: 80 }));
    expect(box).toHaveValue(80);
  });

  it("the range stores a number", () => {
    const onChange = vi.fn();
    render(<Harness section={newSection("hero", ID)} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(f.overlay), { target: { value: "50" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ overlay: 50 }));
  });

  it("a switch stores a boolean", async () => {
    const onChange = vi.fn();
    render(<Harness section={newSection("featured_collection", ID)} onChange={onChange} />);
    click(screen.getByRole("switch", { name: f.showViewAll }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showViewAll: false }));
  });

  it("the form shows the section's problems (removed collection)", () => {
    const section = withSettings(newSection("featured_collection", ID), { collection: "c-gone" });
    render(<Harness section={section} targets={{ collection: {}, product: {}, page: {} }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.onlineStoreSections.problems.removed_collection,
    );
  });

  it("source decides whether the product picker or the count shows", () => {
    render(<Harness section={newSection("featured_products", ID)} />);
    expect(screen.queryByLabelText(f.products)).toBeNull();
    expect(screen.getByLabelText(f.count)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: opt.manual }));
    expect(screen.getByLabelText(f.products)).toBeInTheDocument();
    expect(screen.queryByLabelText(f.count)).toBeNull();
  });

  it("renders in Arabic from the same dictionary", () => {
    render(<Harness section={newSection("hero", ID)} t={ar} locale="ar" />);
    expect(screen.getByLabelText(ar.onlineStoreSections.fields.overlay)).toBeInTheDocument();
  });
});

describe("link field", () => {
  it("has a No link option that stores null", async () => {
    const onChange = vi.fn();
    render(<Harness section={newSection("hero", ID)} onChange={onChange} />);
    choose(screen.getByLabelText(f.buttonLink), "none");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ buttonLink: null }));
    expect(screen.getByLabelText(f.buttonLink)).toHaveValue("none");
    expect(screen.getByRole("option", { name: opt.noLink })).toBeInTheDocument();
  });

  it("a null link starts as No link", () => {
    render(<Harness section={withSettings(newSection("hero", ID), { buttonLink: null })} />);
    expect(screen.getByLabelText(f.buttonLink)).toHaveValue("none");
  });

  it("a web address is typed in its own box and its error shows there", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        section={withSettings(newSection("announcement_bar", ID), {
          link: { type: "url", url: "" },
        })}
        path="header.announcement"
        errors={{ "header.announcement.settings.link.url": "bad url" }}
        onChange={onChange}
      />,
    );
    const box = screen.getByLabelText(en.onlineStoreNavigation.webAddress);
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("bad url");
    type(box, "https://a.example");
    leave(document.activeElement as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ link: { type: "url", url: "https://a.example/" } }),
    );
  });

  it("picking a collection calls onTarget with the kind, id and title", async () => {
    const onTarget = vi.fn();
    actions.searchLinkTargetsAction.mockResolvedValue([
      { id: "c-1", title: "Sale", subtitle: "/collections/sale" },
    ]);
    render(<Harness section={newSection("hero", ID)} onTarget={onTarget} />);
    choose(screen.getByLabelText(f.buttonLink), "collection");
    click(await screen.findByRole("button", { name: /Sale/ }));
    expect(onTarget).toHaveBeenCalledWith("collection", "c-1", "Sale");
  });
});

describe("image field", () => {
  const stored = {
    id: "img-1",
    url: "https://cdn.example/a.png",
    alt: "A cat",
    width: 10,
    height: 10,
  };
  const hero = withSettings(newSection("hero", ID), { image: "img-1" });

  it("shows the picture and its alt text, saved on blur through the action", async () => {
    actions.updateImageAltAction.mockResolvedValue({ status: "ok" });
    const onImage = vi.fn();
    render(<Harness section={hero} images={{ "img-1": stored }} onImage={onImage} />);
    const alt = screen.getAllByLabelText(img.alt)[0]!;
    expect(alt).toHaveValue("A cat");
    expect(alt).toHaveAttribute("maxlength", String(IMAGE_ALT_MAX));
    type(alt, "");
    type(alt, "A dog");
    leave(document.activeElement as HTMLElement);
    expect(actions.updateImageAltAction).toHaveBeenCalledWith("img-1", "A dog");
    await act(async () => {});
    expect(onImage).toHaveBeenCalledWith({ ...stored, alt: "A dog" });
  });

  it("does not save an unchanged alt text", async () => {
    render(<Harness section={hero} images={{ "img-1": stored }} />);
    click(screen.getAllByLabelText(img.alt)[0]!);
    leave(document.activeElement as HTMLElement);
    expect(actions.updateImageAltAction).not.toHaveBeenCalled();
  });

  it("a failed or thrown save shows the localised error", async () => {
    actions.updateImageAltAction.mockRejectedValue(new Error("offline"));
    render(<Harness section={hero} images={{ "img-1": stored }} />);
    const alt = screen.getAllByLabelText(img.alt)[0]!;
    type(alt, "!");
    leave(document.activeElement as HTMLElement);
    expect(await screen.findByText(img.altError)).toBeInTheDocument();
    expect(alt).toHaveAttribute("aria-invalid", "true");
  });

  it("a ref missing from the map says the image was removed, and Remove clears it", async () => {
    const onChange = vi.fn();
    render(<Harness section={hero} images={{}} onChange={onChange} />);
    expect(screen.getAllByText(img.removed)[0]).toBeInTheDocument();
    click(screen.getAllByRole("button", { name: img.remove })[0]!);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ image: null }));
  });

  it("choosing from the library stores the ref and registers the image", async () => {
    const onChange = vi.fn();
    const onImage = vi.fn();
    actions.listLibraryImagesAction.mockResolvedValue({
      status: "ok",
      items: [{ id: "img-9", name: "Shoes", image: { ...stored, id: "img-9" } }],
      endCursor: null,
      hasNextPage: false,
    });
    render(<Harness section={newSection("hero", ID)} onChange={onChange} onImage={onImage} />);
    click(screen.getAllByRole("button", { name: img.library })[0]!);
    click(await screen.findByRole("button", { name: "Shoes" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ image: "img-9" }));
    expect(onImage).toHaveBeenCalledWith({ ...stored, id: "img-9" });
  });
});
