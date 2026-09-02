import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Page } from "./page";
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
