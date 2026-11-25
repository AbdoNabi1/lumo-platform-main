import { cleanup, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  type StaffActivityItem,
  type StaffActivityKind,
} from "@/lib/staff/two-step";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { ActivitySentence } from "./activity-sentence";

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
});

function item(
  kind: StaffActivityKind,
  overrides: Partial<StaffActivityItem> = {},
): StaffActivityItem {
  return {
    id: `id-${kind}`,
    at: "2026-11-24T12:00:00.000Z",
    kind,
    actorEmail: "sam@shop.example",
    subjectEmail: "mona@shop.example",
    detail: {},
    ...overrides,
  };
}

function text(row: StaffActivityItem, t: Dictionary): string {
  const { container } = render(<ActivitySentence item={row} t={t} />);
  const out = container.textContent ?? "";
  cleanup();
  return out;
}

const EXPECTED_EN: Readonly<Record<StaffActivityKind, string>> = {
  signed_in: "sam@shop.example signed in.",
  sign_in_failed: "A sign-in as mona@shop.example failed (wrong password).",
  code_failed: "A wrong code was entered for mona@shop.example.",
  invited: "sam@shop.example invited mona@shop.example.",
  invitation_accepted: "mona@shop.example accepted the invitation.",
  invitation_revoked: "sam@shop.example revoked the invitation to mona@shop.example.",
  role_changed: "sam@shop.example changed the role of mona@shop.example.",
  deactivated: "sam@shop.example deactivated mona@shop.example.",
  reactivated: "sam@shop.example reactivated mona@shop.example.",
  two_step_on: "mona@shop.example turned on two-step verification.",
  two_step_off: "mona@shop.example turned off two-step verification.",
  backup_codes_regenerated: "mona@shop.example got new backup codes.",
  two_step_policy_changed: "sam@shop.example stopped requiring two-step verification.",
};

describe("ActivitySentence", () => {
  it("covers every kind the server can send", () => {
    expect([...ACTIVITY_KINDS].sort()).toEqual(Object.keys(EXPECTED_EN).sort());
  });

  it.each(ACTIVITY_KINDS)("reads %s in English", (kind) => {
    expect(text(item(kind), en)).toBe(EXPECTED_EN[kind]);
  });

  it.each(ACTIVITY_KINDS)(
    "reads %s in Arabic with both emails intact and no English left over",
    (kind) => {
      const sentence = text(item(kind), ar);
      expect(sentence).toMatch(/[\u0600-\u06FF]/);
      expect(sentence).not.toBe(EXPECTED_EN[kind]);
      const needs = [
        "signed_in",
        "invited",
        "invitation_revoked",
        "role_changed",
        "deactivated",
        "reactivated",
        "two_step_policy_changed",
      ] as const;
      if ((needs as readonly string[]).includes(kind))
        expect(sentence).toContain("sam@shop.example");
    },
  );

  it("says who changed whose role from what to what, with the locale's role names", () => {
    const row = item("role_changed", { detail: { from: "operator", to: "viewer" } });
    expect(text(row, en)).toBe(
      "sam@shop.example changed the role of mona@shop.example from Operator to Viewer.",
    );
    expect(text(row, ar)).toBe("غيّر sam@shop.example دور mona@shop.example من مشغّل إلى مشاهد.");
  });

  it("names the role an invitation offered", () => {
    expect(text(item("invited", { detail: { to: "admin" } }), en)).toBe(
      "sam@shop.example invited mona@shop.example as Admin.",
    );
  });

  it("two-step policy: on and off", () => {
    expect(text(item("two_step_policy_changed", { detail: { enabled: true } }), en)).toBe(
      "sam@shop.example started requiring two-step verification for everyone.",
    );
    expect(text(item("two_step_policy_changed", { detail: { enabled: false } }), en)).toBe(
      "sam@shop.example stopped requiring two-step verification.",
    );
  });

  it("isolates every email in a bdi dir=auto", () => {
    const { container } = render(<ActivitySentence item={item("role_changed")} t={en} />);
    const emails = Array.from(container.querySelectorAll("bdi"));
    expect(emails.map((node) => node.textContent)).toEqual([
      "sam@shop.example",
      "mona@shop.example",
    ]);
    for (const node of emails) expect(node).toHaveAttribute("dir", "auto");
  });

  it("an unknown person reads Someone, in both languages, with no empty bdi", () => {
    const row = item("signed_in", { actorEmail: null, subjectEmail: null });
    expect(text(row, en)).toBe("Someone signed in.");
    expect(text(row, ar)).toContain(ar.usersActivity.someone);
    const { container } = render(<ActivitySentence item={row} t={en} />);
    expect(container.querySelector("bdi")).toBeNull();
  });

  it("a person who acts on themself appears once as actor and subject", () => {
    const row = item("two_step_on", { actorEmail: null, subjectEmail: "mona@shop.example" });
    expect(text(row, en)).toBe("mona@shop.example turned on two-step verification.");
    const sign = item("signed_in", { actorEmail: null, subjectEmail: "mona@shop.example" });
    expect(text(sign, en)).toBe("mona@shop.example signed in.");
  });
});
