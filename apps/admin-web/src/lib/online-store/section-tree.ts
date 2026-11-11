import {
  HOMEPAGE_SECTIONS_MAX,
  isKnownSection,
  newSection,
  sectionDefinition,
  type AnnouncementSection,
  type Section,
  type SectionType,
  type ThemeDocument,
} from "@platform/storefront-content";

/**
 * Pure edits of the section tree (spec 3.3, Ruling 22). Client-safe: no `lib/api` import. Every
 * function returns a new document, or the same object when nothing changes (a blocked add, an
 * unknown id), so a caller can tell by identity that there is nothing to save. Section ids are only
 * ever compared, never used as keys of an object.
 */

/** Where a section lives: the header's single slot, or an index into the homepage list. */
export type SectionPlace = "announcement" | number;

export function findSection(
  doc: ThemeDocument,
  id: string,
): { readonly section: Section; readonly place: SectionPlace } | null {
  const bar = doc.header.announcement;
  if (bar !== null && bar.id === id) return { section: bar, place: "announcement" };
  const index = doc.homepage.sections.findIndex((section) => section.id === id);
  const section = doc.homepage.sections[index];
  return section === undefined ? null : { section, place: index };
}

export type AddBlock = "ok" | "limit" | "type_limit";

function homepageBlock(sections: readonly Section[], type: string): AddBlock {
  if (sections.length >= HOMEPAGE_SECTIONS_MAX) return "limit";
  const max = sectionDefinition(type)?.maxPerPage ?? null;
  if (max !== null && sections.filter((section) => section.type === type).length >= max)
    return "type_limit";
  return "ok";
}

/** The announcement is `type_limit` when its slot is full; the homepage is `limit` at 25. */
export function canAddSection(doc: ThemeDocument, type: SectionType): AddBlock {
  if (type === "announcement_bar") return doc.header.announcement === null ? "ok" : "type_limit";
  return homepageBlock(doc.homepage.sections, type);
}

const withSections = (doc: ThemeDocument, sections: readonly Section[]): ThemeDocument => ({
  ...doc,
  homepage: { ...doc.homepage, sections },
});

export function addSection(doc: ThemeDocument, type: SectionType, id: string): ThemeDocument {
  if (canAddSection(doc, type) !== "ok" || findSection(doc, id) !== null) return doc;
  const section = newSection(type, id);
  if (type === "announcement_bar") {
    return { ...doc, header: { ...doc.header, announcement: section as AnnouncementSection } };
  }
  return withSections(doc, [...doc.homepage.sections, section]);
}

/** Homepage only: the copy goes right below the original, with the same settings. */
export function duplicateSection(doc: ThemeDocument, id: string, newId: string): ThemeDocument {
  const found = findSection(doc, id);
  if (found === null || found.place === "announcement") return doc;
  if (findSection(doc, newId) !== null) return doc;
  if (homepageBlock(doc.homepage.sections, found.section.type) !== "ok") return doc;
  const sections = [...doc.homepage.sections];
  sections.splice(found.place + 1, 0, { ...found.section, id: newId });
  return withSections(doc, sections);
}

export function removeSection(doc: ThemeDocument, id: string): ThemeDocument {
  const found = findSection(doc, id);
  if (found === null) return doc;
  if (found.place === "announcement") {
    return { ...doc, header: { ...doc.header, announcement: null } };
  }
  return withSections(
    doc,
    doc.homepage.sections.filter((_, index) => index !== found.place),
  );
}

/** Clamped: moving past either end, or moving the announcement, changes nothing. */
export function moveSection(doc: ThemeDocument, id: string, delta: -1 | 1): ThemeDocument {
  const found = findSection(doc, id);
  if (found === null || found.place === "announcement") return doc;
  const to = found.place + delta;
  if (to < 0 || to >= doc.homepage.sections.length) return doc;
  const sections = [...doc.homepage.sections];
  const [moved] = sections.splice(found.place, 1);
  sections.splice(to, 0, moved as Section);
  return withSections(doc, sections);
}

function replaceSection(doc: ThemeDocument, id: string, next: Section): ThemeDocument {
  const found = findSection(doc, id);
  if (found === null) return doc;
  if (found.place === "announcement") {
    return { ...doc, header: { ...doc.header, announcement: next as AnnouncementSection } };
  }
  return withSections(
    doc,
    doc.homepage.sections.map((section, index) => (index === found.place ? next : section)),
  );
}

export function setSectionHidden(doc: ThemeDocument, id: string, hidden: boolean): ThemeDocument {
  const found = findSection(doc, id);
  if (found === null || found.section.hidden === hidden) return doc;
  return replaceSection(doc, id, { ...found.section, hidden });
}

/** Known sections only: an unsupported section's settings are kept verbatim (Ruling 7). */
export function updateSectionSettings(
  doc: ThemeDocument,
  id: string,
  settings: Readonly<Record<string, unknown>>,
): ThemeDocument {
  const found = findSection(doc, id);
  if (found === null || !isKnownSection(found.section)) return doc;
  return replaceSection(doc, id, { ...found.section, settings });
}
