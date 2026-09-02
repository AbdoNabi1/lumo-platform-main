import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ContentBlock } from "./content-block";
import { BlockBody } from "./value-objects/block-body";

function block(): ContentBlock {
  return ContentBlock.create(
    UniqueEntityId.from("block-1"),
    "Homepage hero",
    "hero",
    BlockBody.create("html", "<h1>Welcome</h1>"),
  );
}

describe("ContentBlock", () => {
  it("starts at draft", () => {
    const b = block();
    expect(b.status.value).toBe("draft");
    expect(b.versions).toHaveLength(0);
  });

  it("publishing appends a version snapshot", () => {
    const b = block();
    b.publish("evt-1", new Date(0));
    expect(b.status.value).toBe("published");
    expect(b.versions).toHaveLength(1);
    expect(b.versions[0]?.versionNumber).toBe(1);
  });

  it("schedules for a future publish", () => {
    const b = block();
    b.schedule(new Date(1000), "evt-1", new Date(0));
    expect(b.status.value).toBe("scheduled");
    expect(b.scheduledAt).toEqual(new Date(1000));
  });

  it("rejects editing an archived block", () => {
    const b = block();
    b.archive("evt-1", new Date(0));
    expect(() => b.updateBody(BlockBody.create("html", "<p>x</p>"))).toThrow(BusinessRuleError);
  });

  it("rejects an illegal transition (archived -> published, 409)", () => {
    const b = block();
    b.archive("evt-1", new Date(0));
    expect(() => b.transition("published", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
