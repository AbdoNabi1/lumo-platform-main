import { describe, expect, it } from "vitest";
import { Registry } from "./registry";
import { JsonRegistrySerializer } from "./providers";

interface Thing {
  readonly label: string;
}

describe("Registry Engine discovery + import/export (P1.1.1 §6/§8)", () => {
  function seeded(): Registry<Thing> {
    const r = new Registry<Thing>({ name: "things" });
    r.register({
      key: "ai.copy",
      value: { label: "Copy" },
      tags: ["ai"],
      descriptor: {
        aliases: ["copywriter"],
        keywords: ["marketing", "gpt"],
        category: "ai",
        owner: "growth",
        ai: { description: "generates marketing copy" },
      },
    });
    r.register({
      key: "commerce.checkout",
      value: { label: "Checkout" },
      tags: ["commerce"],
      descriptor: { keywords: ["cart", "pay"], category: "commerce" },
    });
    return r;
  }

  it("searches across keys, tags, aliases, keywords and category", () => {
    const r = seeded();
    expect(r.search("copywriter").map((e) => e.key)).toEqual(["ai.copy"]);
    expect(r.search("marketing").map((e) => e.key)).toEqual(["ai.copy"]);
    expect(r.search("commerce").map((e) => e.key)).toEqual(["commerce.checkout"]);
    expect(r.search("").length).toBe(2);
  });

  it("resolves by alias", () => {
    expect(seeded().findByAlias("copywriter")?.key).toBe("ai.copy");
    expect(seeded().findByAlias("nope")).toBeNull();
  });

  it("round-trips a definitions-only snapshot through the JSON serializer", () => {
    const source = seeded();
    source.deprecate("commerce.checkout");
    const serializer = new JsonRegistrySerializer<Thing>();
    const snapshot = source.exportSnapshot();
    const json = serializer.export(snapshot);
    expect(json.ok).toBe(true);
    if (!json.ok) return;

    const parsed = serializer.import(json.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const target = new Registry<Thing>({ name: "things" });
    const imported = target.importSnapshot(parsed.value);
    expect(imported.ok).toBe(true);
    expect(target.get("ai.copy")?.value.label).toBe("Copy");
    expect(target.get("ai.copy")?.descriptor?.aliases).toEqual(["copywriter"]);
    expect(target.get("commerce.checkout")?.status).toBe("deprecated"); // status preserved
  });

  it("rejects malformed JSON on import (fail-closed)", () => {
    const serializer = new JsonRegistrySerializer<Thing>();
    expect(serializer.import("{ not json").ok).toBe(false);
    expect(serializer.import('{"foo":1}').ok).toBe(false);
  });
});
