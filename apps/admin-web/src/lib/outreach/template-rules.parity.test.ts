import { describe, expect, it } from "vitest";
import { validateTemplateDraft as domainValidate, type TemplateDraft } from "@platform/outreach";
import { ALL_FIXTURES } from "./template-rules.fixtures";
import { validateTemplateDraft as mirrorValidate } from "./template-rules";

/**
 * R3-O02: the browser mirror and the REAL Task 2 domain validator (`@platform/outreach`, a test-only devDependency)
 * get the same fixtures and must agree on the normalised `{field, code}` arrays, so a rule changed in one place and
 * not the other fails here.
 */
const normalise = (issues: readonly { field: string; code: string }[]) =>
  issues.map(({ field, code }) => ({ field, code }));

describe("template rules parity: browser mirror vs @platform/outreach validateTemplateDraft", () => {
  it.each(ALL_FIXTURES.map((f) => [f.name, f] as const))("agrees on %s", (_name, fixture) => {
    expect.hasAssertions();
    const draft = fixture.draft as TemplateDraft;
    expect(normalise(mirrorValidate(fixture.draft))).toEqual(normalise(domainValidate(draft)));
  });

  it("the real validator reproduces every fixture's expected issues (the fixtures are not stale)", () => {
    expect.hasAssertions();
    for (const fixture of ALL_FIXTURES) {
      expect(normalise(domainValidate(fixture.draft as TemplateDraft)), fixture.name).toEqual(
        normalise(fixture.issues),
      );
    }
  });
});
