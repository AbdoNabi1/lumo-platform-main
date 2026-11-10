import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  savePageContentAction: vi.fn(),
  advancePageAction: vi.fn(),
  createPageAction: vi.fn(),
}));
vi.mock("@/app/pages/actions", () => actions);
const { PageCreateForm } = await import("./page-create-form");

afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
});

const field = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
const address = () => screen.getByLabelText(en.pageEditor.address) as HTMLInputElement;

describe("PageCreateForm (spec 2.4, Ruling 19)", () => {
  it("derives the page address from the title until the merchant edits it", () => {
    const { container } = render(<PageCreateForm t={en} locale="en" />);
    expect(address().value).toBe("");
    fireEvent.change(field(container, "title.en"), { target: { value: "About Us" } });
    expect(address().value).toBe("/pages/about-us");
    fireEvent.change(address(), { target: { value: "/pages/who-we-are" } });
    fireEvent.change(field(container, "title.en"), { target: { value: "About our shop" } });
    expect(address().value).toBe("/pages/who-we-are");
  });

  it("an Arabic-only title gets one stable page-<random> address", () => {
    const { container } = render(<PageCreateForm t={en} locale="en" />);
    fireEvent.change(field(container, "title.ar"), { target: { value: "من" } });
    const first = address().value;
    expect(first).toMatch(/^\/pages\/page-[a-z0-9]{4}$/);
    fireEvent.change(field(container, "title.ar"), { target: { value: "من نحن" } });
    expect(address().value).toBe(first);
  });

  it("posts the title, the content and the address", async () => {
    actions.createPageAction.mockResolvedValue({ status: "idle" });
    const { container } = render(<PageCreateForm t={en} locale="en" />);
    fireEvent.change(field(container, "title.en"), { target: { value: "About" } });
    fireEvent.change(field(container, "body.en"), { target: { value: "Hello" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    const data = actions.createPageAction.mock.calls[0]?.[1] as FormData;
    expect(data.get("title.en")).toBe("About");
    expect(data.get("body.en")).toBe("Hello");
    expect(data.get("routePath")).toBe("/pages/about");
    expect(data.get("templateRef")).toBeNull();
  });

  it("a taken address is shown on the address field", async () => {
    actions.createPageAction.mockResolvedValue({
      status: "error",
      message: en.pageEditor.addressTaken,
      fieldErrors: { routePath: en.pageEditor.addressTaken },
    });
    const { container } = render(<PageCreateForm t={en} locale="en" />);
    fireEvent.change(field(container, "title.en"), { target: { value: "About" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(address()).toHaveAttribute("aria-invalid", "true");
    const describedBy = (address().getAttribute("aria-describedby") ?? "").split(" ");
    const texts = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toContain(en.pageEditor.addressTaken);
  });

  it("a crashed action shows our own copy", async () => {
    actions.createPageAction.mockRejectedValue(new Error("offline"));
    const { container } = render(<PageCreateForm t={en} locale="en" />);
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
  });
});
