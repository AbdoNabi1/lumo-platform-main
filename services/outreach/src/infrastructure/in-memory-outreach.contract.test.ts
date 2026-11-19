import { runOutreachRepositoryContract } from "../testing/outreach-repository-contract";
import { createInMemoryOutreach } from "./in-memory-outreach-wiring";

runOutreachRepositoryContract("in-memory", ({ clock }) =>
  Promise.resolve({
    repos: createInMemoryOutreach({ clock, platformTenantId: "platform" }),
  }),
);
