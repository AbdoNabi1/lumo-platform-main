import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { CustomersHeader } = await import("./customers-header");

const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  nav.search = "";
});

describe("CustomersHeader", () => {
  it("shows the title and subtitle", () => {
    render(<CustomersHeader canEdit canExport t={en} />);

    expect(body().getByRole("heading", { level: 1, name: "Customers" })).toBeInTheDocument();
    expect(body().getByText(en.customersPage.subtitle)).toBeInTheDocument();
  });

  it("an operator gets Export and Add customer (a link to /customers/new)", () => {
    render(<CustomersHeader canEdit canExport t={en} />);

    expect(body().getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(body().getByRole("link", { name: "Add customer" })).toHaveAttribute(
      "href",
      "/customers/new",
    );
  });

  it("a viewer or unknown role (canEdit and canExport false) gets neither, not even in a dialog", () => {
    render(<CustomersHeader canEdit={false} canExport={false} t={en} />);

    expect(body().queryByRole("button")).toBeNull();
    expect(body().queryByRole("link")).toBeNull();
    expect(body().queryByRole("dialog")).toBeNull();
    expect(body().getByRole("heading", { level: 1, name: "Customers" })).toBeInTheDocument();
  });

  it("each button follows its own flag", () => {
    const { unmount } = render(<CustomersHeader canEdit canExport={false} t={en} />);
    expect(body().queryByRole("button", { name: "Export" })).toBeNull();
    expect(body().getByRole("link", { name: "Add customer" })).toBeInTheDocument();
    unmount();

    render(<CustomersHeader canEdit={false} canExport t={en} />);
    expect(body().getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(body().queryByRole("link", { name: "Add customer" })).toBeNull();
  });

  it("renders in Arabic", () => {
    render(<CustomersHeader canEdit canExport t={ar} />);

    expect(body().getByRole("button", { name: ar.customersPage.export })).toBeInTheDocument();
    expect(body().getByRole("link", { name: ar.customersPage.addCustomer })).toBeInTheDocument();
    expect(body().queryByText("Add customer")).toBeNull();
  });
});

describe("the Export dialog", () => {
  function open() {
    render(<CustomersHeader canEdit canExport t={en} />);
    const trigger = body().getByRole("button", { name: "Export" });
    fireEvent.click(trigger);
    return trigger;
  }

  it("has a title, a description, Current search and All customers, and an Export customers button", async () => {
    open();

    const dialog = await body().findByRole("dialog", { name: "Export customers" });
    expect(dialog).toHaveAccessibleDescription(en.customersExport.description);
    expect(within(dialog).getByRole("radio", { name: "Current search" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "All customers" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Export customers" })).toBeInTheDocument();
  });

  it("with no search, All customers is chosen and Current search is unavailable", async () => {
    open();

    const dialog = await body().findByRole("dialog", { name: "Export customers" });
    expect(within(dialog).getByRole("radio", { name: "All customers" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Current search" })).toBeDisabled();
    await waitFor(() =>
      expect(within(dialog).getByRole("radio", { name: "All customers" })).toHaveFocus(),
    );
  });

  it("with a search, Current search is chosen and the form carries scope and q (GET /customers/export)", async () => {
    nav.search = "q=nour&after=c9";
    open();

    const dialog = await body().findByRole("dialog", { name: "Export customers" });
    const search = within(dialog).getByRole("radio", { name: "Current search" });
    expect(search).toBeChecked();
    expect(search).toBeEnabled();
    await waitFor(() => expect(search).toHaveFocus());
    const form = dialog.querySelector("form");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/customers/export");
    const data = new FormData(form as HTMLFormElement);
    expect(data.get("scope")).toBe("search");
    expect(data.get("q")).toBe("nour");
    expect(data.has("after")).toBe(false);
    fireEvent.click(within(dialog).getByRole("radio", { name: "All customers" }));
    expect(new FormData(form as HTMLFormElement).get("scope")).toBe("all");
  });

  it("Escape closes it and focus returns to the Export button, which stayed mounted", async () => {
    const trigger = open();
    const dialog = await body().findByRole("dialog", { name: "Export customers" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("Cancel closes it and focus returns to the Export button", async () => {
    const trigger = open();
    const dialog = await body().findByRole("dialog", { name: "Export customers" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("renders in Arabic", async () => {
    render(<CustomersHeader canEdit canExport t={ar} />);
    fireEvent.click(body().getByRole("button", { name: ar.customersPage.export }));

    const dialog = await body().findByRole("dialog", { name: ar.customersExport.title });
    expect(dialog).toHaveAccessibleDescription(ar.customersExport.description);
    expect(within(dialog).getByRole("radio", { name: ar.customersExport.all })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: ar.customersExport.submit })).toBeVisible();
  });
});
