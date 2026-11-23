import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { LeadDto } from "@/lib/api/leads";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { LeadsTable } from "./leads-table";

beforeEach(() => {
  expect.hasAssertions();
});

function lead(overrides: Partial<LeadDto> = {}): LeadDto {
  return {
    id: "lead-1",
    formId: "form-1",
    name: "منى أحمد",
    phone: "01001234567",
    phoneE164: "+201001234567",
    email: "mona@example.com",
    message: "عايزة أعرف السعر",
    status: "new",
    trackingStatus: "pending",
    eventId: "lead_lead-1",
    createdAt: "2026-11-22T10:05:00.000Z",
    pageUrl: null,
    referrer: null,
    ...overrides,
  };
}

describe("LeadsTable", () => {
  it("wraps the phone and the email in <bdi dir=ltr> and the name in <bdi dir=auto>", () => {
    const { container } = render(<LeadsTable leads={[lead()]} t={en} locale="en" />);

    const phone = screen.getByText("01001234567");
    expect(phone.tagName).toBe("BDI");
    expect(phone).toHaveAttribute("dir", "ltr");
    const email = screen.getByText("mona@example.com");
    expect(email.tagName).toBe("BDI");
    expect(email).toHaveAttribute("dir", "ltr");
    const name = screen.getByText("منى أحمد");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
    expect(container.querySelectorAll('bdi[dir="ltr"]')).toHaveLength(2);
  });

  it("shows the message excerpt (first 80 characters) in <bdi dir=auto>", () => {
    const message = "x".repeat(80) + "TAIL";
    render(<LeadsTable leads={[lead({ message })]} t={en} locale="en" />);

    const excerpt = screen.getByText(`${"x".repeat(80)}…`);
    expect(excerpt.tagName).toBe("BDI");
    expect(excerpt).toHaveAttribute("dir", "auto");
    expect(screen.queryByText(/TAIL/)).toBeNull();
  });

  it("leaves a message of exactly 80 characters whole", () => {
    const message = "y".repeat(80);
    render(<LeadsTable leads={[lead({ message })]} t={en} locale="en" />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("shows a dash for a missing email and message", () => {
    render(<LeadsTable leads={[lead({ email: null, message: null })]} t={en} locale="en" />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("links the row to /leads/{id}", () => {
    render(<LeadsTable leads={[lead({ id: "abc 1" })]} t={en} locale="en" />);
    expect(screen.getByRole("link", { name: "منى أحمد" })).toHaveAttribute(
      "href",
      "/leads/abc%201",
    );
  });

  it("renders the status as badge text", () => {
    render(<LeadsTable leads={[lead({ status: "spam" })]} t={en} locale="en" />);
    expect(screen.getByText(en.leadStatus.spam)).toBeInTheDocument();
  });

  it("has column headers with scope and a labelled, focusable scroll region", () => {
    render(<LeadsTable leads={[lead()]} t={en} locale="en" />);

    const region = screen.getByRole("region", { name: en.leadsPage.title });
    expect(region).toHaveAttribute("tabindex", "0");
    const headers = within(region).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      en.leadsPage.columns.date,
      en.leadsPage.columns.name,
      en.leadsPage.columns.phone,
      en.leadsPage.columns.email,
      en.leadsPage.columns.message,
      en.leadsPage.columns.status,
    ]);
    for (const header of headers) expect(header).toHaveAttribute("scope", "col");
  });

  it("formats the date through Intl for the locale", () => {
    const { rerender } = render(<LeadsTable leads={[lead()]} t={en} locale="en" />);
    expect(screen.getByText(/Nov 22, 2026/)).toBeInTheDocument();
    rerender(<LeadsTable leads={[lead()]} t={ar} locale="ar" />);
    expect(screen.queryByText(/Nov 22, 2026/)).toBeNull();
    expect(screen.getByRole("region", { name: ar.leadsPage.title })).toBeInTheDocument();
  });
});
