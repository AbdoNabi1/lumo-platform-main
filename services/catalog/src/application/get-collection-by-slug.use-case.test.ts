import { describe, expect, it } from "vitest";
import type { Collection } from "../domain/collection";
import { GetCollectionBySlug } from "./get-collection-by-slug.use-case";

describe("GetCollectionBySlug", () => {
  it("returns the collection the repository finds by slug", async () => {
    const collection = { id: "collection-1" } as unknown as Collection;
    const collections = {
      save: async () => {},
      findById: async () => null,
      findBySlug: async (slug: string) => (slug === "featured-toys" ? collection : null),
      delete: async () => {},
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      search: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    };
    const useCase = new GetCollectionBySlug({ collections });
    const result = await useCase.execute({ slug: "featured-toys" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(collection);
    }
  });

  it("returns a NotFoundError when no collection has that slug", async () => {
    const collections = {
      save: async () => {},
      findById: async () => null,
      findBySlug: async () => null,
      delete: async () => {},
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      search: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    };
    const useCase = new GetCollectionBySlug({ collections });
    const result = await useCase.execute({ slug: "no-such-slug" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});
