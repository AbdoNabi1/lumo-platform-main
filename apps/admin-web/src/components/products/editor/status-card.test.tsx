import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { StatusCard } from "./status-card";

const t = en.productEditor;

describe("StatusCard", () => {
  it("offers exactly active, draft and unlisted, each with its hint", () => {
    render(<StatusCard status="draft" errors={{}} t={en} />);

    const select = screen.getByRole("combobox", { name: t.statusCard });
    const options = within(select).getAllByRole("option");
    expect(options.map((option) => [option.getAttribute("value"), option.textContent])).toEqual([
      ["published", en.productStatus.published],
      ["draft", en.productStatus.draft],
      ["unlisted", en.productStatus.unlisted],
    ]);
    expect(en.productStatus.published).toBe("Active");
    expect(screen.getByText(t.statusDraftHint)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "unlisted" } });
    expect(screen.getByText(t.statusUnlistedHint)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "published" } });
    expect(screen.getByText(t.statusPublishedHint)).toBeInTheDocument();
  });

  it.each(["archived", "scheduled"])("renders no select for a %s product", (status) => {
    render(<StatusCard status={status} errors={{}} t={en} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(t.statusLocked)).toBeInTheDocument();
    expect(
      screen.getByText((en.productStatus as Record<string, string>)[status]!),
    ).toBeInTheDocument();
  });
});
