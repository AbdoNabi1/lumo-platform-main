import { beforeEach, describe, expect } from "vitest";
import { InMemoryLeadRepository } from "../infrastructure/in-memory-lead-repository";
import { describeLeadUseCases } from "../testing/lead-use-case-suite";

beforeEach(() => {
  expect.hasAssertions();
});

describe.each([{ name: "in-memory", makeRepo: () => new InMemoryLeadRepository() }])(
  "use cases over the $name repository",
  ({ makeRepo }) => {
    describeLeadUseCases(makeRepo);
  },
);
