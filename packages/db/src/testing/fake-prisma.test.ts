import { describe, expect, it } from "vitest";
import { createFakePrisma } from "./fake-prisma";

interface Delegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
}

describe("createFakePrisma where operators", () => {
  const seed = async (): Promise<Delegate> => {
    const model = (createFakePrisma().database as unknown as Record<string, Delegate>)["page"]!;
    for (const routePath of ["/pages/about", "/pages/faq", "/landing"]) {
      await model.create({ data: { routePath } });
    }
    return model;
  };

  it("startsWith matches only string prefixes", async () => {
    const model = await seed();
    const found = await model.findMany({ where: { routePath: { startsWith: "/pages/" } } });
    expect(found.map((r) => r["routePath"])).toEqual(["/pages/about", "/pages/faq"]);
  });

  it("an unknown operator still throws", async () => {
    const model = await seed();
    await expect(model.findMany({ where: { routePath: { endsWith: "x" } } })).rejects.toThrow(
      /unsupported where operator/,
    );
  });
});
