import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  fetchStaff: vi.fn(),
  fetchStaffActivity: vi.fn(),
  locale: { value: undefined as string | undefined },
  nav: { search: "", push: vi.fn() },
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale.value === undefined ? undefined : { value: mocks.locale.value }),
    }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.nav.push }),
  usePathname: () => "/settings/users/activity",
  useSearchParams: () => new URLSearchParams(mocks.nav.search),
}));
vi.mock("@/lib/api/staff", () => ({
  fetchStaff: mocks.fetchStaff,
  fetchStaffActivity: mocks.fetchStaffActivity,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { default: ActivityPage } = await import("./page");

const PEOPLE = [
  { principalExternalId: "pid-sam", email: "sam@shop.example" },
  { principalExternalId: "pid-mona", email: "mona@shop.example" },
];

function row(id: string, kind: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    at: "2026-11-24T12:00:00.000Z",
    kind,
    actorEmail: "sam@shop.example",
    subjectEmail: "mona@shop.example",
    detail: {},
    ...overrides,
  };
}

async function open(params: { member?: string; after?: string; stack?: string } = {}) {
  render(await ActivityPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  mocks.fetchStaff.mockReset();
  mocks.fetchStaffActivity.mockReset();
  mocks.nav.push.mockReset();
  mocks.nav.search = "";
  mocks.locale.value = undefined;
  mocks.fetchStaff.mockResolvedValue({ outcome: "ok", data: { items: PEOPLE } });
  mocks.fetchStaffActivity.mockResolvedValue({
    outcome: "ok",
    data: {
      items: [
        row("a1", "role_changed", { detail: { from: "operator", to: "viewer" } }),
        row("a2", "signed_in", { subjectEmail: null }),
      ],
      nextCursor: null,
    },
  });
});

const pushed = () =>
  new URL(mocks.nav.push.mock.calls.at(-1)?.[0] as string, "http://x").searchParams;

describe("/settings/users/activity", () => {
  it("renders When / Who / What with a localized sentence per row, inside the settings frame", async () => {
    await open();
    expect(
      screen.getByRole("heading", { level: 1, name: en.usersActivity.title }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: en.usersActivity.listLabel });
    for (const column of ["when", "who", "what"] as const) {
      expect(
        within(table).getByRole("columnheader", { name: en.usersActivity.columns[column] }),
      ).toBeInTheDocument();
    }
    expect(table).toHaveTextContent(
      "sam@shop.example changed the role of mona@shop.example from Operator to Viewer.",
    );
    expect(table).toHaveTextContent("sam@shop.example signed in.");
    const nav = screen.getByRole("navigation", { name: en.settingsNav.label });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/settings/users"]);
  });

  it("asks the API for 25 rows, the cursor and the member from the URL", async () => {
    await open({ member: "pid-mona", after: "cur-1", stack: "" });
    expect(mocks.fetchStaffActivity).toHaveBeenCalledWith({
      member: "pid-mona",
      cursor: "cur-1",
      limit: 25,
    });
  });

  it("passes no member or cursor on the first page", async () => {
    await open();
    expect(mocks.fetchStaffActivity).toHaveBeenCalledWith({ limit: 25 });
  });

  it("offers a member filter select with Everyone and each person, the current one selected", async () => {
    await open({ member: "pid-mona" });
    const select = screen.getByLabelText(en.usersActivity.filterLabel) as HTMLSelectElement;
    expect(select).toHaveAttribute("name", "member");
    expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
      ["", en.usersActivity.filterAll],
      ["pid-sam", "sam@shop.example"],
      ["pid-mona", "mona@shop.example"],
    ]);
    expect(select.value).toBe("pid-mona");
    const form = select.closest("form") as HTMLFormElement;
    expect(form).toHaveAttribute("method", "get");
    expect(
      within(form).getByRole("button", { name: en.usersActivity.filterApply }),
    ).toHaveAttribute("type", "submit");
  });

  it("links back to Users and permissions", async () => {
    await open();
    expect(screen.getByRole("link", { name: en.usersActivity.back })).toHaveAttribute(
      "href",
      "/settings/users",
    );
  });

  it("pages with the stack: Next stacks the current cursor and keeps the member filter", async () => {
    mocks.fetchStaffActivity.mockResolvedValue({
      outcome: "ok",
      data: { items: [row("a1", "signed_in")], nextCursor: "cur-2" },
    });
    mocks.nav.search = "member=pid-mona&after=cur-1";
    await open({ member: "pid-mona", after: "cur-1" });
    fireEvent.click(screen.getByRole("button", { name: en.customersPage.next }));
    expect(pushed().get("after")).toBe("cur-2");
    expect(pushed().get("stack")).toBe("cur-1");
    expect(pushed().get("member")).toBe("pid-mona");
    expect(screen.getByRole("button", { name: en.customersPage.previous })).toBeEnabled();
  });

  it("the first page with no more rows shows no pager", async () => {
    await open();
    expect(screen.queryByRole("button", { name: en.customersPage.next })).toBeNull();
    expect(screen.queryByRole("button", { name: en.customersPage.previous })).toBeNull();
  });

  it("Previous pops the stack", async () => {
    mocks.nav.search = "after=cur-2&stack=cur-0%2Ccur-1";
    await open({ after: "cur-2", stack: "cur-0,cur-1" });
    fireEvent.click(screen.getByRole("button", { name: en.customersPage.previous }));
    expect(pushed().get("after")).toBe("cur-1");
    expect(pushed().get("stack")).toBe("cur-0");
  });

  it("an empty later page keeps Previous", async () => {
    mocks.fetchStaffActivity.mockResolvedValue({
      outcome: "ok",
      data: { items: [], nextCursor: null },
    });
    mocks.nav.search = "after=cur-1&stack=";
    await open({ after: "cur-1", stack: "" });
    expect(screen.getByRole("alert")).toHaveTextContent(en.usersActivity.empty);
    const previous = screen.getByRole("button", { name: en.customersPage.previous });
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    expect(mocks.nav.push).toHaveBeenCalled();
    expect(pushed().get("after")).toBeNull();
  });

  it("an empty first page says there is no activity yet, with no pager", async () => {
    mocks.fetchStaffActivity.mockResolvedValue({
      outcome: "ok",
      data: { items: [], nextCursor: null },
    });
    await open();
    expect(screen.getByRole("alert")).toHaveTextContent(en.usersActivity.empty);
    expect(screen.queryByRole("button", { name: en.customersPage.previous })).toBeNull();
  });

  it("renders in Arabic when the locale cookie says so", async () => {
    mocks.locale.value = "ar";
    await open();
    expect(
      screen.getByRole("heading", { level: 1, name: ar.usersActivity.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: ar.usersActivity.listLabel })).toHaveTextContent(
      "غيّر sam@shop.example دور mona@shop.example من مشغّل إلى مشاهد.",
    );
    expect(screen.queryByText(en.usersActivity.title)).toBeNull();
  });

  it("says who may open it on a 403, with no table", async () => {
    mocks.fetchStaffActivity.mockResolvedValue({ outcome: "unauthorized", status: 403 });
    await open();
    expect(screen.getByRole("alert")).toHaveTextContent(en.usersActivity.forbidden);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("asks to sign in on a 401 and shows a load error otherwise (never the raw message)", async () => {
    mocks.fetchStaffActivity.mockResolvedValue({ outcome: "unauthorized" });
    await open();
    expect(screen.getByRole("alert")).toHaveTextContent(en.usersActivity.unauthorized);
    cleanup();
    mocks.fetchStaffActivity.mockResolvedValue({ outcome: "error", message: "boom", status: 500 });
    await open();
    expect(screen.getByRole("alert")).toHaveTextContent(en.usersActivity.loadError);
    expect(screen.queryByText("boom")).toBeNull();
  });

  it("still lists the activity when the staff list could not be loaded (the filter just has Everyone)", async () => {
    mocks.fetchStaff.mockResolvedValue({ outcome: "error", message: "x" });
    await open();
    const select = screen.getByLabelText(en.usersActivity.filterLabel) as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
