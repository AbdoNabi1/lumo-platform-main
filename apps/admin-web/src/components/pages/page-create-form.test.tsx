import { afterEach, describe, expect, it, vi } from "vitest";
import { Component, type ReactNode } from "react";
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
  vi.restoreAllMocks();
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

  it("a redirect after creating reaches Next inside a transition, not as an unhandled rejection (M-8)", async () => {
    const { redirect } = await import("next/navigation");
    actions.createPageAction.mockImplementation(async () => redirect("/pages/p-9"));
    const caught: unknown[] = [];
    class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
      override state = { error: null as unknown };
      static getDerivedStateFromError(error: unknown) {
        return { error };
      }
      override componentDidCatch(error: unknown) {
        caught.push(error);
      }
      override render() {
        return this.state.error === null ? this.props.children : <p>redirected</p>;
      }
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(
      <Boundary>
        <PageCreateForm t={en} locale="en" />
      </Boundary>,
    );
    fireEvent.change(field(container, "title.en"), { target: { value: "About" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(await screen.findByText("redirected")).toBeInTheDocument();
    expect(caught[0]).toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(screen.queryByText(en.formErrors.unexpected)).toBeNull();
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
