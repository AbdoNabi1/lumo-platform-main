import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PageDto } from "@/lib/api/pages";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  savePageContentAction: vi.fn(),
  advancePageAction: vi.fn(),
  createPageAction: vi.fn(),
}));
vi.mock("@/app/pages/actions", () => actions);
const { PageAddress, PageContentForm } = await import("./page-content-form");
const { PageLifecycleActions } = await import("./page-lifecycle-actions");

const page = (extra: Partial<PageDto> = {}): PageDto => ({
  id: "p-1",
  name: "about",
  routePath: "/pages/about",
  templateRef: null,
  experienceRef: null,
  seoProfileRef: null,
  localeRef: null,
  status: "draft",
  title: { en: "About us" },
  metaDescription: { en: "Who we are" },
  body: { en: "## Hello" },
  publishedAt: null,
  updatedAt: "2026-11-01T10:00:00.000Z",
  version: 2,
  ...extra,
});
const e = en.pageEditor;

afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
  vi.restoreAllMocks();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe("PageAddress (spec 2.4)", () => {
  it("labels a page outside /pages/ as not on the storefront, and links a published one", () => {
    const { rerender } = render(
      <PageAddress
        t={en}
        routePath="/landing"
        status="published"
        storefrontUrl="https://nour.example"
      />,
    );
    expect(screen.getByText(e.notOnStorefront)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: e.viewOnStore })).toBeNull();
    rerender(
      <PageAddress
        t={en}
        routePath="/pages/about"
        status="published"
        storefrontUrl="https://nour.example/"
      />,
    );
    expect(screen.queryByText(e.notOnStorefront)).toBeNull();
    expect(screen.getByRole("link", { name: e.viewOnStore })).toHaveAttribute(
      "href",
      "https://nour.example/pages/about",
    );
    rerender(
      <PageAddress
        t={en}
        routePath="/pages/about"
        status="draft"
        storefrontUrl="https://nour.example"
      />,
    );
    expect(screen.queryByRole("link", { name: e.viewOnStore })).toBeNull();
    expect(screen.getByText("/pages/about")).toHaveAttribute("dir", "ltr");
  });
});

describe("PageLifecycleActions (Ruling 15)", () => {
  it("offers Hide for a published page and Publish for a draft (Ruling 15)", () => {
    const { rerender } = render(
      <PageLifecycleActions t={en} pageId="p-1" status="published" canEdit />,
    );
    expect(screen.getByRole("button", { name: e.hide })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: e.archive })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: e.publish })).toBeNull();
    rerender(<PageLifecycleActions t={en} pageId="p-1" status="draft" canEdit />);
    expect(screen.getByRole("button", { name: e.publish })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: e.hide })).toBeNull();
    rerender(<PageLifecycleActions t={en} pageId="p-1" status="archived" canEdit />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("hides a page, then keeps keyboard focus in the actions when the buttons change", async () => {
    actions.advancePageAction.mockResolvedValue({ status: "success" });
    const { rerender } = render(
      <PageLifecycleActions t={en} pageId="p-1" status="published" canEdit />,
    );
    const hide = screen.getByRole("button", { name: e.hide });
    hide.focus();
    fireEvent.click(hide);
    await flush();
    expect(actions.advancePageAction).toHaveBeenCalledWith("p-1", "draft");
    // The server refresh swaps Hide for Publish: focus must not fall back to the page body.
    rerender(<PageLifecycleActions t={en} pageId="p-1" status="draft" canEdit />);
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: en.pageLifecycle.title }),
    );
  });

  it("asks before archiving (it cannot be undone)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PageLifecycleActions t={en} pageId="p-1" status="draft" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: e.archive }));
    await flush();
    expect(confirm).toHaveBeenCalledWith(e.archiveConfirm);
    expect(actions.advancePageAction).not.toHaveBeenCalled();
  });

  it("a refused or crashed transition shows our own copy and gives the buttons back", async () => {
    actions.advancePageAction.mockResolvedValueOnce({
      status: "error",
      message: en.onlineStorePreferences.conflict,
      fieldErrors: {},
    });
    actions.advancePageAction.mockRejectedValueOnce(new Error("offline"));
    render(<PageLifecycleActions t={en} pageId="p-1" status="draft" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: e.publish }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStorePreferences.conflict);
    fireEvent.click(screen.getByRole("button", { name: e.publish }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
    expect(screen.getByRole("button", { name: e.publish })).toBeEnabled();
  });

  it("shows nothing to a viewer", () => {
    render(<PageLifecycleActions t={en} pageId="p-1" status="draft" canEdit={false} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("PageContentForm (spec 2.4, 2.7)", () => {
  it("saves title, content and meta description with the version; the next save sends the new one", async () => {
    actions.savePageContentAction.mockResolvedValueOnce({ status: "success", version: 3 });
    actions.savePageContentAction.mockResolvedValueOnce({ status: "success", version: 4 });
    const { container } = render(<PageContentForm t={en} locale="en" page={page()} canEdit />);
    const body = container.querySelector<HTMLTextAreaElement>('textarea[name="body.en"]');
    fireEvent.change(body!, { target: { value: "## New" } });
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(actions.savePageContentAction).toHaveBeenLastCalledWith("p-1", {
      title: { en: "About us" },
      body: { en: "## New" },
      metaDescription: { en: "Who we are" },
      expectedVersion: 2,
    });
    expect(screen.getByRole("status")).toHaveTextContent(en.onlineStorePreferences.saved);
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(actions.savePageContentAction).toHaveBeenLastCalledWith(
      "p-1",
      expect.objectContaining({ expectedVersion: 3 }),
    );
  });

  it("a lost race keeps the edits and shows the reload copy", async () => {
    actions.savePageContentAction.mockResolvedValue({
      status: "error",
      message: ar.onlineStorePreferences.conflict,
      fieldErrors: {},
    });
    const { container } = render(<PageContentForm t={ar} locale="ar" page={page()} canEdit />);
    const body = container.querySelector<HTMLTextAreaElement>('textarea[name="body.en"]');
    fireEvent.change(body!, { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: ar.onlineStorePreferences.save }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(ar.onlineStorePreferences.conflict);
    expect(body!.value).toBe("edited");
  });

  it("a crashed save shows our own copy and gives the button back", async () => {
    actions.savePageContentAction.mockRejectedValue(new Error("offline"));
    render(<PageContentForm t={en} locale="en" page={page()} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
    expect(screen.getByRole("button", { name: en.onlineStorePreferences.save })).toBeEnabled();
  });

  it("is read-only for a viewer", () => {
    const { container } = render(
      <PageContentForm t={en} locale="en" page={page()} canEdit={false} />,
    );
    expect(screen.queryByRole("button", { name: en.onlineStorePreferences.save })).toBeNull();
    for (const field of container.querySelectorAll("input, textarea")) {
      expect(field).toBeDisabled();
    }
  });

  it("an archived page cannot be edited either", () => {
    render(<PageContentForm t={en} locale="en" page={page({ status: "archived" })} canEdit />);
    expect(screen.queryByRole("button", { name: en.onlineStorePreferences.save })).toBeNull();
  });
});
