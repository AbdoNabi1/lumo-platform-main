import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const api = vi.hoisted(() => ({ fetchSegmentMembers: vi.fn() }));
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  search: { value: "" },
}));
vi.mock("@/lib/api/customer-segments", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/customers/segments/s-1",
  useSearchParams: () => new URLSearchParams(nav.search.value),
}));

const { SegmentMembers, SEGMENT_MEMBERS_PAGE_SIZE } = await import("./segment-members");

const member = (id: string, name: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  isGuest: false,
  ordersCount: 1,
  amountSpentMinor: 1000,
  lastOrderAt: null,
  emailSubscribed: false,
  smsSubscribed: false,
});
const page = (over: Record<string, unknown> = {}) => ({
  outcome: "ok" as const,
  data: {
    items: [member("c-1", "Nour"), member("c-2", "Sam")],
    pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
    total: 41,
    currency: "EGP",
    ...over,
  },
});

async function show(
  props: Partial<{ search: string; after: string; stack: string }> = {},
  t: Dictionary = en,
) {
  const ui = await SegmentMembers({
    segmentId: "s-1",
    search: props.search,
    after: props.after,
    stack: props.stack,
    t,
    locale: t === ar ? "ar" : "en",
  });
  return render(ui);
}

beforeEach(() => {
  expect.hasAssertions();
  api.fetchSegmentMembers.mockReset();
  nav.push.mockReset();
  nav.search.value = "";
});

describe("SegmentMembers", () => {
  it("fetches one page with the search and cursor, shows the live total and the table", async () => {
    api.fetchSegmentMembers.mockResolvedValue(page());

    await show({ search: "nour", after: "cursor-1" });

    expect(api.fetchSegmentMembers).toHaveBeenCalledWith("s-1", {
      first: SEGMENT_MEMBERS_PAGE_SIZE,
      after: "cursor-1",
      search: "nour",
    });
    expect(screen.getByRole("status")).toHaveTextContent("41 customers");
    expect(screen.getByRole("table", { name: en.segments.members.tableLabel })).toBeVisible();
    expect(screen.getByText("Nour")).toBeVisible();
  });

  it("omits blank search and cursor from the request", async () => {
    api.fetchSegmentMembers.mockResolvedValue(page());

    await show({ search: "", after: "" });

    expect(api.fetchSegmentMembers).toHaveBeenCalledWith("s-1", {
      first: SEGMENT_MEMBERS_PAGE_SIZE,
    });
  });

  it("Next keeps the search and pushes the end cursor with a stack of the earlier cursors", async () => {
    nav.search.value = "q=nour&after=cursor-1&stack=";
    api.fetchSegmentMembers.mockResolvedValue(page());
    await show({ search: "nour", after: "cursor-1" });

    fireEvent.click(screen.getByRole("button", { name: en.customersPage.next }));

    expect(nav.push).toHaveBeenCalledTimes(1);
    const url = new URL(nav.push.mock.calls[0]![0] as string, "http://x");
    expect(url.pathname).toBe("/customers/segments/s-1");
    expect(url.searchParams.get("q")).toBe("nour");
    expect(url.searchParams.get("after")).toBe("cursor-2");
    expect(url.searchParams.get("stack")).toBe("cursor-1");
  });

  it("Previous pops the stack (pagination stack algorithm shared with the customers list)", async () => {
    nav.search.value = "q=nour&after=cursor-2&stack=cursor-1";
    api.fetchSegmentMembers.mockResolvedValue(
      page({ pageInfo: { hasNextPage: false, endCursor: null } }),
    );
    await show({ search: "nour", after: "cursor-2", stack: "cursor-1" });

    fireEvent.click(screen.getByRole("button", { name: en.customersPage.previous }));

    const url = new URL(nav.push.mock.calls[0]![0] as string, "http://x");
    expect(url.searchParams.get("after")).toBe("cursor-1");
    expect(url.searchParams.get("stack")).toBeNull();
    expect(url.searchParams.get("q")).toBe("nour");
  });

  it("an empty later page keeps Previous; an empty unfiltered first page has no pagination", async () => {
    nav.search.value = "after=cursor-9";
    api.fetchSegmentMembers.mockResolvedValue(
      page({ items: [], total: 3, pageInfo: { hasNextPage: false, endCursor: null } }),
    );
    const { unmount } = await show({ after: "cursor-9" });
    expect(screen.getByText(en.segments.members.empty)).toBeVisible();
    expect(screen.getByRole("button", { name: en.customersPage.previous })).toBeEnabled();
    unmount();

    nav.search.value = "";
    api.fetchSegmentMembers.mockResolvedValue(
      page({ items: [], total: 0, pageInfo: { hasNextPage: false, endCursor: null } }),
    );
    await show();
    expect(screen.getByText(en.segments.members.empty)).toBeVisible();
    expect(screen.queryByRole("button", { name: en.customersPage.previous })).toBeNull();
  });

  it("an empty search result says nothing matches the search", async () => {
    api.fetchSegmentMembers.mockResolvedValue(
      page({ items: [], total: 0, pageInfo: { hasNextPage: false, endCursor: null } }),
    );

    await show({ search: "zzz" });

    expect(screen.getByText(en.segments.members.emptyFiltered)).toBeVisible();
  });

  it("503 UNAVAILABLE shows 'Segments need the store database'; any other error the members error", async () => {
    api.fetchSegmentMembers.mockResolvedValueOnce({
      outcome: "error",
      message: "x",
      status: 503,
      code: "UNAVAILABLE",
    });
    const { unmount } = await show();
    expect(screen.getByText(en.segments.unavailable)).toBeVisible();
    unmount();

    api.fetchSegmentMembers.mockResolvedValueOnce({ outcome: "error", message: "x", status: 503 });
    const second = await show();
    expect(screen.getByText(en.segments.members.error)).toBeVisible();
    expect(screen.queryByText(en.segments.unavailable)).toBeNull();
    second.unmount();

    api.fetchSegmentMembers.mockResolvedValueOnce({ outcome: "error", message: "x", status: 500 });
    await show();
    expect(screen.getByText(en.segments.members.error)).toBeVisible();
  });

  it("unauthorized and not_found have their own messages", async () => {
    api.fetchSegmentMembers.mockResolvedValueOnce({ outcome: "unauthorized" });
    const { unmount } = await show();
    expect(screen.getByText(en.segments.unauthorized)).toBeVisible();
    unmount();

    api.fetchSegmentMembers.mockResolvedValueOnce({ outcome: "not_found" });
    await show();
    expect(screen.getByText(en.segments.notFound)).toBeVisible();
  });

  it("renders in Arabic with the Arabic plural count and Arabic pagination", async () => {
    api.fetchSegmentMembers.mockResolvedValue(page({ total: 2 }));

    await show({}, ar);

    expect(screen.getByRole("status")).toHaveTextContent("عميلان");
    expect(
      screen.getByRole("columnheader", { name: ar.segments.members.columns.name }),
    ).toBeVisible();
    expect(
      within(document.body).getByRole("button", { name: ar.customersPage.next }),
    ).toBeVisible();
  });
});
