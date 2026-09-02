import { describe, expect, it } from "vitest";
import { RelationshipGraph, RelationTuple } from "./relationship";

const tuple = (
  namespace: string,
  object: string,
  relation: string,
  subject: string,
): RelationTuple =>
  new RelationTuple({
    id: `${object}#${relation}@${subject}`,
    namespace,
    object,
    relation,
    subject,
  });

describe("RelationshipGraph (ReBAC)", () => {
  const graph = new RelationshipGraph();

  it("resolves a direct relation", () => {
    const tuples = [tuple("app", "doc:readme", "viewer", "alice")];
    expect(
      graph.check(tuples, {
        namespace: "app",
        object: "doc:readme",
        relation: "viewer",
        subjectId: "alice",
      }),
    ).toBe(true);
    expect(
      graph.check(tuples, {
        namespace: "app",
        object: "doc:readme",
        relation: "viewer",
        subjectId: "bob",
      }),
    ).toBe(false);
  });

  it("expands subject-sets (group membership)", () => {
    const tuples = [
      tuple("app", "doc:readme", "viewer", "grp:eng#member"),
      tuple("app", "grp:eng", "member", "alice"),
    ];
    expect(
      graph.check(tuples, {
        namespace: "app",
        object: "doc:readme",
        relation: "viewer",
        subjectId: "alice",
      }),
    ).toBe(true);
    expect(
      graph.check(tuples, {
        namespace: "app",
        object: "doc:readme",
        relation: "viewer",
        subjectId: "carol",
      }),
    ).toBe(false);
  });

  it("is cycle-safe", () => {
    const tuples = [tuple("app", "a", "x", "b#x"), tuple("app", "b", "x", "a#x")];
    expect(
      graph.check(tuples, { namespace: "app", object: "a", relation: "x", subjectId: "nobody" }),
    ).toBe(false);
  });
});

describe("RelationTuple.parseKey (H-2 sync)", () => {
  it("round-trips key() for direct and subject-set subjects", () => {
    for (const props of [
      { namespace: "permissions", object: "doc:1", relation: "viewer", subject: "principal:a" },
      {
        namespace: "permissions",
        object: "doc:1",
        relation: "viewer",
        subject: "group:eng#member",
      },
      { namespace: "app", object: "org/acme/billing", relation: "admin", subject: "u-9" },
    ]) {
      const key = new RelationTuple({ id: "x", ...props }).key();
      expect(RelationTuple.parseKey(key)).toEqual(props);
    }
  });

  it("returns null for a malformed key", () => {
    expect(RelationTuple.parseKey("not-a-tuple")).toBeNull();
    expect(RelationTuple.parseKey("ns:object#relation")).toBeNull(); // no @subject
    expect(RelationTuple.parseKey("nocolon#rel@s")).toBeNull(); // no namespace colon
  });
});
