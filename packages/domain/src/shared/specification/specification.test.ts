import { describe, expect, it } from "vitest";
import { Specification } from "./specification";

class GreaterThan extends Specification<number> {
  private readonly min: number;

  constructor(min: number) {
    super();
    this.min = min;
  }

  isSatisfiedBy(candidate: number): boolean {
    return candidate > this.min;
  }
}

class LessThan extends Specification<number> {
  private readonly max: number;

  constructor(max: number) {
    super();
    this.max = max;
  }

  isSatisfiedBy(candidate: number): boolean {
    return candidate < this.max;
  }
}

describe("Specification", () => {
  const gt5 = new GreaterThan(5);
  const lt10 = new LessThan(10);

  it("combines with and", () => {
    const between = gt5.and(lt10);
    expect(between.isSatisfiedBy(7)).toBe(true);
    expect(between.isSatisfiedBy(5)).toBe(false);
    expect(between.isSatisfiedBy(10)).toBe(false);
  });

  it("combines with or", () => {
    const spec = gt5.or(lt10);
    expect(spec.isSatisfiedBy(3)).toBe(true);
    expect(spec.isSatisfiedBy(20)).toBe(true);
  });

  it("negates with not", () => {
    expect(gt5.not().isSatisfiedBy(3)).toBe(true);
    expect(gt5.not().isSatisfiedBy(7)).toBe(false);
  });

  it("composes nested combinators", () => {
    const outside = gt5.and(lt10).not();
    expect(outside.isSatisfiedBy(7)).toBe(false);
    expect(outside.isSatisfiedBy(11)).toBe(true);
  });
});
