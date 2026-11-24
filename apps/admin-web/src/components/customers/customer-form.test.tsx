import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  createCustomerAction: vi.fn(),
}));
vi.mock("@/app/customers/actions", () => actions);

const { CustomerForm } = await import("./customer-form");

const k = en.customerForm;
const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  actions.createCustomerAction.mockReset();
  actions.createCustomerAction.mockResolvedValue({ status: "idle" });
});

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: k.save }));
}

async function submittedData(): Promise<FormData> {
  await waitFor(() => expect(actions.createCustomerAction).toHaveBeenCalledTimes(1));
  return actions.createCustomerAction.mock.calls[0]?.[1] as FormData;
}

describe("CustomerForm", () => {
  it("renders Shopify's fields and both marketing checkboxes, unchecked", () => {
    render(<CustomerForm t={en} />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
    expect(screen.getByLabelText("Tags")).toBeInTheDocument();
    const marketingEmail = screen.getByRole("checkbox", {
      name: "Customer agreed to receive marketing emails.",
    });
    const marketingSms = screen.getByRole("checkbox", {
      name: "Customer agreed to receive SMS marketing text messages.",
    });
    expect(marketingEmail).not.toBeChecked();
    expect(marketingSms).not.toBeChecked();
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "العربية" })).toBeInTheDocument();
  });

  it("states the assertion honestly: it makes no consent or compliance claim", () => {
    render(<CustomerForm t={en} />);

    expect(body().getByText(k.marketingNote)).toBeVisible();
    expect(document.body.textContent ?? "").not.toMatch(/complian|GDPR|legal|opt-in verified/i);
  });

  it("renders in Arabic from ar.customerForm, with start-aligned left-to-right contact fields", () => {
    render(<CustomerForm t={ar} />);

    expect(screen.getByLabelText(ar.customerForm.name)).toHaveAttribute("dir", "auto");
    expect(screen.getByLabelText(ar.customerForm.email)).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText(ar.customerForm.phone)).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText(ar.customerForm.email)).toHaveClass("text-start");
    expect(screen.getByRole("checkbox", { name: ar.customerForm.marketingEmail })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: ar.customerForm.marketingSms })).toBeVisible();
    expect(screen.getByRole("button", { name: ar.customerForm.save })).toBeVisible();
    expect(screen.queryByText(en.customerForm.name)).toBeNull();
  });

  it("submits every field to the create action", async () => {
    render(<CustomerForm t={en} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Nour Hassan" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nour@example.com" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+201001234567" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "ar" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Prefers calls" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Customer agreed to receive marketing emails." }),
    );
    submit();

    const data = await submittedData();
    expect(data.get("name")).toBe("Nour Hassan");
    expect(data.get("email")).toBe("nour@example.com");
    expect(data.get("phone")).toBe("+201001234567");
    expect(data.get("language")).toBe("ar");
    expect(data.get("note")).toBe("Prefers calls");
    expect(data.get("marketingEmail")).toBe("on");
    expect(data.get("marketingSms")).toBeNull();
    expect(data.get("tags")).toBe("");
  });

  it("turns comma-separated tags into chips, de-duplicating case-insensitively", () => {
    render(<CustomerForm t={en} />);
    const tags = screen.getByLabelText("Tags");

    fireEvent.change(tags, { target: { value: "VIP, Cairo, vip," } });
    fireEvent.change(tags, { target: { value: "cairo" } });
    fireEvent.keyDown(tags, { key: "Enter" });

    const list = screen.getByRole("list", { name: k.tagsAdded });
    const chips = within(list).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual(["VIP", "Cairo"]);
    for (const text of ["VIP", "Cairo"]) {
      const bdi = within(list).getByText(text);
      expect(bdi.tagName).toBe("BDI");
      expect(bdi).toHaveAttribute("dir", "auto");
    }
    expect(tags).toHaveValue("");
  });

  it("Enter in the tag box adds a tag and does not submit the form", () => {
    render(<CustomerForm t={en} />);
    const tags = screen.getByLabelText("Tags");

    fireEvent.change(tags, { target: { value: "gold" } });
    const notPrevented = fireEvent.keyDown(tags, { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(actions.createCustomerAction).not.toHaveBeenCalled();
    expect(screen.getByText("gold")).toBeInTheDocument();
  });

  it("an Arabic comma separates tags too, and Arabic tags sit in bdi", () => {
    render(<CustomerForm t={en} />);

    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "عميل مميز،VIP،" } });

    const chip = screen.getByText("عميل مميز");
    expect(chip.tagName).toBe("BDI");
    expect(screen.getByText("VIP")).toBeInTheDocument();
  });

  it("removes a chip with its labelled button", () => {
    render(<CustomerForm t={en} />);
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "VIP,Cairo," } });

    fireEvent.click(screen.getByRole("button", { name: "Remove tag VIP" }));

    expect(screen.queryByText("VIP")).toBeNull();
    expect(screen.getByText("Cairo")).toBeInTheDocument();
  });

  it("sends the chips and any text still in the box as one comma-separated value", async () => {
    render(<CustomerForm t={en} />);
    const tags = screen.getByLabelText("Tags");
    fireEvent.change(tags, { target: { value: "VIP," } });
    fireEvent.change(tags, { target: { value: "Cairo" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "N" } });

    submit();

    const data = await submittedData();
    expect(data.get("tags")).toBe("VIP,Cairo");
  });

  it("shows each 422 field message under its own field and keeps what was typed", async () => {
    actions.createCustomerAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: {
        name: "Enter a name",
        phone: "Enter a valid phone number",
        tags: "A tag can be at most 40 characters",
        note: "A note can be at most 5000 characters",
      },
    });
    render(<CustomerForm t={en} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "x" } });

    submit();

    expect(await screen.findByText("Enter a name")).toBeVisible();
    for (const [label, message] of [
      ["Name", "Enter a name"],
      ["Phone number", "Enter a valid phone number"],
      ["Tags", "A tag can be at most 40 characters"],
      ["Notes", "A note can be at most 5000 characters"],
    ] as const) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(expect.stringContaining(message));
    }
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
    expect(screen.getByLabelText("Phone number")).toHaveValue("x");
  });

  it("shows the duplicate-email message under the Email field", async () => {
    actions.createCustomerAction.mockResolvedValue({
      status: "error",
      message: k.duplicateEmail,
      fieldErrors: { email: k.duplicateEmail },
    });
    render(<CustomerForm t={en} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dup@example.com" } });

    submit();

    expect(await screen.findByText("A customer with this email already exists.")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveValue("dup@example.com");
    // Field-level only: not repeated as a second banner.
    expect(screen.queryAllByText("A customer with this email already exists.")).toHaveLength(1);
  });

  it("shows a message with no field as an alert above the buttons", async () => {
    actions.createCustomerAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    render(<CustomerForm t={en} />);

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);
  });

  it("links back to the customers list", () => {
    render(<CustomerForm t={en} />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/customers");
  });
});
