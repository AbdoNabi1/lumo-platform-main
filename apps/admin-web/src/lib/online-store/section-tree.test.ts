import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_DOCUMENT,
  newSection,
  type Section,
  type ThemeDocument,
} from "@platform/storefront-content";
import {
  addSection,
  canAddSection,
  duplicateSection,
  findSection,
  moveSection,
  removeSection,
  setSectionHidden,
  updateSectionSettings,
} from "./section-tree";

beforeEach(() => expect.hasAssertions());

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const ID1 = uuid(901);
const ID2 = uuid(902);
const ID3 = uuid(903);

const doc = (sections: Section[], announcement: Section | null = null): ThemeDocument =>
  ({
    ...DEFAULT_THEME_DOCUMENT,
    header: { ...DEFAULT_THEME_DOCUMENT.header, announcement },
    homepage: { sections },
  }) as ThemeDocument;
const ids = (d: ThemeDocument) => d.homepage.sections.map((s) => s.id);

describe("section tree (spec 3.3, Ruling 22)", () => {
  it("adds at the end; the announcement bar fills the header slot once", () => {
    const one = addSection(doc([]), "hero", ID1);
    expect(ids(one)).toEqual([ID1]);
    const bar = addSection(one, "announcement_bar", ID2);
    expect(bar.header.announcement?.id).toBe(ID2);
    expect(ids(bar)).toEqual([ID1]);
    expect(canAddSection(bar, "announcement_bar")).toBe("type_limit");
    expect(addSection(bar, "announcement_bar", ID3)).toBe(bar);
    expect(canAddSection(one, "announcement_bar")).toBe("ok");
  });

  it("refuses an id that is already used, by add or duplicate", () => {
    const base = doc([newSection("hero", ID1)], newSection("announcement_bar", ID2));
    expect(addSection(base, "features", ID1)).toBe(base);
    expect(addSection(base, "features", ID2)).toBe(base);
    expect(duplicateSection(base, ID1, ID1)).toBe(base);
    expect(duplicateSection(base, ID1, ID2)).toBe(base);
    expect(ids(addSection(base, "features", ID3))).toEqual([ID1, ID3]);
  });

  it("blocks the 26th section and the 4th hero", () => {
    const full = doc(Array.from({ length: 25 }, (_, i) => newSection("rich_text", uuid(i))));
    expect(canAddSection(full, "features")).toBe("limit");
    expect(addSection(full, "features", ID1)).toBe(full);
    const heroes = doc([0, 1, 2].map((i) => newSection("hero", uuid(i))));
    expect(canAddSection(heroes, "hero")).toBe("type_limit");
    expect(addSection(heroes, "hero", ID1)).toBe(heroes);
    expect(canAddSection(heroes, "features")).toBe("ok");
  });

  it("duplicates below with a new id and the same settings; moves clamp; hide toggles", () => {
    const hero = newSection("hero", ID1);
    const base = doc([hero, newSection("features", ID2)]);
    const copy = duplicateSection(base, ID1, ID3);
    expect(ids(copy)).toEqual([ID1, ID3, ID2]);
    expect(copy.homepage.sections[1]).toEqual({ ...hero, id: ID3 });
    expect(moveSection(base, ID1, -1)).toEqual(base);
    expect(ids(moveSection(base, ID1, 1))).toEqual([ID2, ID1]);
    expect(ids(moveSection(base, ID2, -1))).toEqual([ID2, ID1]);
    expect(ids(moveSection(base, ID2, 1))).toEqual([ID1, ID2]);
    const hidden = setSectionHidden(base, ID1, true);
    expect(hidden.homepage.sections[0]?.hidden).toBe(true);
    expect(setSectionHidden(hidden, ID1, false).homepage.sections[0]?.hidden).toBe(false);
    const heroes = doc([0, 1, 2].map((i) => newSection("hero", uuid(i))));
    expect(duplicateSection(heroes, uuid(0), ID1)).toBe(heroes);
    const bar = doc([], newSection("announcement_bar", ID2));
    expect(duplicateSection(bar, ID2, ID3)).toBe(bar);
  });

  it("removes from either place; unsupported sections move, hide and remove like others", () => {
    const odd: Section = { id: ID3, type: "future_thing", hidden: false, settings: { a: 1 } };
    const base = doc([newSection("hero", ID1), odd], newSection("announcement_bar", ID2));
    expect(removeSection(base, ID2).header.announcement).toBeNull();
    expect(ids(removeSection(base, ID1))).toEqual([ID3]);
    expect(removeSection(base, ID3).homepage.sections).toHaveLength(1);
    expect(ids(moveSection(base, ID3, -1))).toEqual([ID3, ID1]);
    expect(setSectionHidden(base, ID3, true).homepage.sections[1]?.hidden).toBe(true);
    expect(removeSection(base, uuid(777))).toBe(base);
  });

  it("finds a section in the announcement slot or by index", () => {
    const base = doc(
      [newSection("hero", ID1), newSection("features", ID2)],
      newSection("announcement_bar", ID3),
    );
    expect(findSection(base, ID3)?.place).toBe("announcement");
    expect(findSection(base, ID2)?.place).toBe(1);
    expect(findSection(base, uuid(5))).toBeNull();
    expect(findSection(base, "__proto__")).toBeNull();
  });

  it("updates settings of a known section only, leaving others untouched (same identity)", () => {
    const hero = newSection("hero", ID1);
    const odd: Section = { id: ID3, type: "future_thing", hidden: false, settings: { a: 1 } };
    const features = newSection("features", ID2);
    const base = doc([hero, features, odd]);
    const next = updateSectionSettings(base, ID1, { ...hero.settings, height: "large" });
    expect(next.homepage.sections[0]?.settings).toMatchObject({ height: "large" });
    expect(next.homepage.sections[1]).toBe(features);
    expect(next.homepage.sections[2]).toBe(odd);
    expect(updateSectionSettings(base, ID3, { a: 2 })).toBe(base);
    const bar = doc([], newSection("announcement_bar", ID2));
    const edited = updateSectionSettings(bar, ID2, {
      ...bar.header.announcement!.settings,
      text: { en: "Hi" },
    });
    expect(edited.header.announcement?.settings).toMatchObject({ text: { en: "Hi" } });
  });
});
