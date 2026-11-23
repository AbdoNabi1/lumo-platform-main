import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { EmailSenderCard } from "./email-sender-card";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const available = {
  available: true,
  from: "Nour Store <noreply@mail.example.com>",
  replyTo: "hello@nour.example",
};

describe("EmailSenderCard: available", () => {
  it("shows '<store name> via Morbeh', the from address and the reply-to, with a link to General", () => {
    expect.hasAssertions();
    render(<EmailSenderCard settings={available} t={en} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
    const sender = screen.getByText("Sender", { selector: "dt" }).nextElementSibling!;
    expect(sender).toHaveTextContent("Nour Store via Morbeh");
    expect(sender.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(sender.querySelector("bdi")).toHaveTextContent("Nour Store");
    const from = screen.getByText(en.emailSettings.fromAddress).nextElementSibling!;
    expect(from.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(from).toHaveTextContent("noreply@mail.example.com");
    const replyTo = screen.getByText(en.emailSettings.replyTo).nextElementSibling!;
    expect(replyTo.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(replyTo).toHaveTextContent("hello@nour.example");
    expect(screen.getByRole("link", { name: en.emailSettings.changeReplyTo })).toHaveAttribute(
      "href",
      "/settings/general",
    );
  });

  it("states that automation emails are order/transactional only and marketing comes later (B28)", () => {
    expect.hasAssertions();
    render(<EmailSenderCard settings={available} t={en} />);
    expect(document.body).toHaveTextContent("order and transactional");
    expect(document.body).toHaveTextContent("Marketing email comes later");
  });

  it("an Arabic store name keeps its own direction inside an English sentence", () => {
    expect.hasAssertions();
    render(
      <EmailSenderCard
        settings={{ ...available, from: "متجر نور <noreply@mail.example.com>" }}
        t={en}
      />,
    );
    const bdi = screen.getByText("متجر نور");
    expect(bdi.tagName).toBe("BDI");
    expect(bdi).toHaveAttribute("dir", "auto");
  });

  it("says so when the store has no contact email, and still links to General", () => {
    expect.hasAssertions();
    render(<EmailSenderCard settings={{ ...available, replyTo: null }} t={en} />);
    expect(document.body).toHaveTextContent(en.emailSettings.replyToMissing);
    expect(screen.getByRole("link", { name: en.emailSettings.changeReplyTo })).toBeInTheDocument();
  });

  it("renders Arabic copy", () => {
    expect.hasAssertions();
    render(<EmailSenderCard settings={available} t={ar} />);
    expect(screen.getByText(ar.emailSettings.statusAvailable)).toBeInTheDocument();
    expect(document.body).toHaveTextContent("Nour Store عبر Morbeh");
    expect(document.body).toHaveTextContent(ar.emailSettings.transactionalNote);
    expect(document.body).not.toHaveTextContent(en.emailSettings.transactionalNote);
  });
});

describe("EmailSenderCard: unavailable", () => {
  it("shows an info card with no sender details and no change link", () => {
    expect.hasAssertions();
    render(<EmailSenderCard settings={{ available: false, from: null, replyTo: null }} t={en} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      en.emailSettings.unavailableTitle,
    );
    expect(screen.getByText(en.emailSettings.statusUnavailable)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(en.emailSettings.unavailableBody);
    expect(screen.queryByText(en.emailSettings.fromAddress)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
