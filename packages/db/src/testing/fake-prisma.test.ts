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

  it("startsWith never matches a non-string value or a non-string prefix", async () => {
    const model = await seed();
    await model.create({ data: { routePath: 42 } });
    const found = await model.findMany({ where: { routePath: { startsWith: "/pages/" } } });
    expect(found.map((r) => r["routePath"])).toEqual(["/pages/about", "/pages/faq"]);
    expect(await model.findMany({ where: { routePath: { startsWith: 42 } } })).toEqual([]);
  });

  it("an unknown operator still throws", async () => {
    const model = await seed();
    await expect(model.findMany({ where: { routePath: { endsWith: "x" } } })).rejects.toThrow(
      /unsupported where operator/,
    );
  });
});

describe("createFakePrisma delegate behaviour", () => {
  interface Full {
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
    findFirst(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    findMany(args?: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
    }): Promise<Record<string, unknown>[]>;
    count(args?: { where?: Record<string, unknown> }): Promise<number>;
    updateMany(args: {
      where?: Record<string, unknown>;
      data?: Record<string, unknown>;
    }): Promise<{ count: number }>;
    deleteMany(args?: { where?: Record<string, unknown> }): Promise<{ count: number }>;
  }
  const open = async () => {
    const model = (createFakePrisma().database as unknown as Record<string, Full>)["page"]!;
    const day = (d: number) => new Date(Date.UTC(2026, 0, d));
    await model.createMany({
      data: [
        { name: "a", n: 1, at: day(1), tag: null },
        { name: "b", n: 2, at: day(2), tag: "x" },
        { name: "c", n: 3, at: day(3), tag: "y" },
      ],
    });
    return { model, day };
  };
  const names = (rows: Record<string, unknown>[]) => rows.map((r) => r["name"]);

  it("filters by equals, not, in, notIn and the range operators", async () => {
    const { model } = await open();
    expect(names(await model.findMany({ where: { n: { equals: 2 } } }))).toEqual(["b"]);
    expect(names(await model.findMany({ where: { n: { not: 2 } } }))).toEqual(["a", "c"]);
    expect(names(await model.findMany({ where: { n: { in: [1, 3] } } }))).toEqual(["a", "c"]);
    expect(names(await model.findMany({ where: { n: { notIn: [1, 3] } } }))).toEqual(["b"]);
    expect(names(await model.findMany({ where: { n: { gt: 1, lt: 3 } } }))).toEqual(["b"]);
    expect(names(await model.findMany({ where: { n: { gte: 2, lte: 2 } } }))).toEqual(["b"]);
    expect(await model.findMany({ where: { n: { in: "not-an-array" } } })).toEqual([]);
    expect(await model.findMany({ where: { n: { notIn: "not-an-array" } } })).toEqual([]);
  });

  it("matches a Date by instant, null and undefined as written", async () => {
    const { model, day } = await open();
    expect(names(await model.findMany({ where: { at: day(2) } }))).toEqual(["b"]);
    expect(await model.findMany({ where: { n: day(2) } })).toEqual([]);
    expect(names(await model.findMany({ where: { tag: null } }))).toEqual(["a"]);
    expect(await model.findMany({ where: { name: undefined } })).toHaveLength(3);
    expect(await model.findMany({})).toHaveLength(3);
    expect(await model.findMany()).toHaveLength(3);
  });

  it("pages with skip and take, counts, and finds the first match", async () => {
    const { model } = await open();
    expect(names(await model.findMany({ skip: 1 }))).toEqual(["b", "c"]);
    expect(names(await model.findMany({ skip: 1, take: 1 }))).toEqual(["b"]);
    expect(await model.count({ where: { n: { gt: 1 } } })).toBe(2);
    expect(await model.count()).toBe(3);
    expect((await model.findFirst({ where: { n: 3 } }))?.["name"]).toBe("c");
    expect(await model.findFirst({ where: { n: 9 } })).toBeNull();
    expect((await model.findFirst())?.["name"]).toBe("a");
  });

  it("updates (including increment) and deletes the matched rows", async () => {
    const { model } = await open();
    expect(await model.updateMany({ where: { n: 1 }, data: { n: { increment: 10 } } })).toEqual({
      count: 1,
    });
    expect(await model.updateMany({ where: { name: "b" }, data: { tag: "z" } })).toEqual({
      count: 1,
    });
    expect(await model.updateMany({ where: { name: "c" } })).toEqual({ count: 1 });
    expect((await model.findFirst({ where: { name: "a" } }))?.["n"]).toBe(11);
    expect(await model.deleteMany({ where: { name: "a" } })).toEqual({ count: 1 });
    expect(await model.deleteMany()).toEqual({ count: 2 });
    expect(await model.count()).toBe(0);
  });

  it("refuses a where combinator", async () => {
    const { model } = await open();
    await expect(model.findMany({ where: { OR: [] } })).rejects.toThrow(
      /unsupported where combinator/,
    );
  });
});
