import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Page } from "./page";
import { EMPTY_PAGE_CONTENT } from "./page-content";
import { Template } from "./template";
import { RoutePath } from "./value-objects/route-path";

function routePath(value = "/products/:slug"): RoutePath {
  const result = RoutePath.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("Page", () => {
  it("starts at draft", () => {
    const page = Page.create(UniqueEntityId.from("page-1"), "Product detail", routePath());
    expect(page.status).toBe("draft");
  });

  it("publishes and raises a pages.transitioned event", () => {
    const page = Page.create(UniqueEntityId.from("page-1"), "Product detail", routePath());
    page.publish("evt-1", new Date(0));
    expect(page.status).toBe("published");
    expect(page.pullDomainEvents()).toHaveLength(1);
  });

  it("rejects an illegal transition (archived -> published, 409)", () => {
    const page = Page.create(UniqueEntityId.from("page-1"), "Product detail", routePath());
    page.archive("evt-1", new Date(0));
    expect(() => page.transition("published", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});

describe("Template", () => {
  it("starts active and archives", () => {
    const template = Template.create(
      UniqueEntityId.from("template-1"),
      "Product page",
      "experience-1",
    );
    expect(template.status).toBe("active");
    template.archive("evt-1", new Date(0));
    expect(template.status).toBe("archived");
  });

  it("rejects archiving twice", () => {
    const template = Template.create(
      UniqueEntityId.from("template-1"),
      "Product page",
      "experience-1",
    );
    template.archive("evt-1", new Date(0));
    expect(() => template.archive("evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});

describe("Page content and visibility (spec 2.4, Ruling 15)", () => {
  const at = (h: number) => new Date(`2026-11-04T${String(h).padStart(2, "0")}:00:00.000Z`);
  const route = RoutePath.create("/pages/about");
  const make = () =>
    Page.create(UniqueEntityId.from("p-1"), "About", (route as { value: RoutePath }).value);

  it("publish sets publishedAt once; unpublish and republish keep the first date", () => {
    const page = make();
    page.publish("e1", at(1));
    page.transition("draft", "e2", at(2));
    page.publish("e3", at(3));
    expect(page.status).toBe("published");
    expect(page.publishedAt).toEqual(at(1));
    expect(page.updatedAt).toEqual(at(3));
  });

  it("archived stays terminal and cannot take content", () => {
    const page = make();
    page.archive("e1", at(1));
    expect(() => page.transition("draft", "e2", at(2))).toThrow();
    expect(() => page.updateContent(EMPTY_PAGE_CONTENT, at(2))).toThrow(/PAGE_ARCHIVED/);
  });

  it("content updates on draft and published pages stamp updatedAt", () => {
    const page = make();
    page.updateContent(
      { title: { en: "About us" }, body: { en: "Hi" }, metaDescription: {} },
      at(4),
    );
    page.publish("e1", at(5));
    page.updateContent({ title: { ar: "من نحن" }, body: {}, metaDescription: {} }, at(6));
    expect(page.title).toEqual({ ar: "من نحن" });
    expect(page.updatedAt).toEqual(at(6));
  });
});
