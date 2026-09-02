import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { SearchIndex } from "./search-index";

function index(): SearchIndex {
  return SearchIndex.create(UniqueEntityId.from("index-1"), "products");
}

describe("SearchIndex", () => {
  it("starts active with an empty config", () => {
    const i = index();
    expect(i.status.value).toBe("active");
    expect(i.documentCount).toBe(0);
  });

  it("records a document upsert and raises a document.upserted event", () => {
    const i = index();
    i.recordDocumentUpserted("product-1", "evt-1", new Date(0));
    expect(i.documentCount).toBe(1);
    const events = i.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("index.transitioned");
  });

  it("adds and removes a synonym", () => {
    const i = index();
    i.addSynonym("shoe", ["sneaker", "trainer"], "evt-1", new Date(0));
    expect(i.config.synonyms).toHaveLength(1);
    i.removeSynonym("shoe", "evt-2", new Date(0));
    expect(i.config.synonyms).toHaveLength(0);
  });

  it("logs a query without mutating any persisted state", () => {
    const i = index();
    i.logQuery("running shoes", "evt-1", new Date(0));
    expect(i.documentCount).toBe(0);
    expect(i.pullDomainEvents()).toHaveLength(1);
  });

  it("rejects document upserts while rebuilding is not active", () => {
    const i = index();
    i.rebuild("evt-1", new Date(0));
    expect(() => i.recordDocumentUpserted("product-1", "evt-2", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("rejects an illegal transition (disabled -> rebuilding, 409)", () => {
    const i = index();
    i.disable("evt-1", new Date(0));
    expect(() => i.transition("rebuilding", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
