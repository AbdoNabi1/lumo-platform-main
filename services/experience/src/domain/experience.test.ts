import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Experience } from "./experience";
import { Canvas } from "./value-objects/canvas";

describe("Experience", () => {
  it("starts at draft with an empty canvas", () => {
    const e = Experience.create(UniqueEntityId.from("experience-1"), "Homepage", "storefront");
    expect(e.status.value).toBe("draft");
    expect(e.canvas.sections).toHaveLength(0);
  });

  it("updates the draft canvas", () => {
    const e = Experience.create(UniqueEntityId.from("experience-1"), "Homepage", "storefront");
    e.updateCanvas(
      Canvas.create([
        {
          key: "hero",
          slots: [{ key: "content", componentInstances: [{ componentRef: "hero", props: {} }] }],
        },
      ]),
    );
    expect(e.canvas.sections).toHaveLength(1);
  });

  it("publishing appends a version snapshot", () => {
    const e = Experience.create(UniqueEntityId.from("experience-1"), "Homepage", "storefront");
    e.publish("evt-1", new Date(0));
    expect(e.status.value).toBe("published");
    expect(e.versions).toHaveLength(1);
  });

  it("rejects editing an archived experience", () => {
    const e = Experience.create(UniqueEntityId.from("experience-1"), "Homepage", "storefront");
    e.archive("evt-1", new Date(0));
    expect(() => e.updateCanvas(Canvas.empty())).toThrow(BusinessRuleError);
  });

  it("rejects an illegal transition (archived -> published, 409)", () => {
    const e = Experience.create(UniqueEntityId.from("experience-1"), "Homepage", "storefront");
    e.archive("evt-1", new Date(0));
    expect(() => e.transition("published", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
