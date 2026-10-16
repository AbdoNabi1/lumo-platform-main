import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { StatusCard } from "./status-card";

const t = en.productEditor;

function renderCard(status: string) {
  return render(
    <form id="product-editor">
      <StatusCard status={status} errors={{}} t={en} />
    </form>,
  );
}

const trigger = () => screen.getByRole("button", { name: (name) => name.startsWith(t.statusCard) });
const formData = (container: HTMLElement) => new FormData(container.querySelector("form")!);

describe("StatusCard", () => {
  it("offers exactly active, draft and unlisted, each with its description", async () => {
    renderCard("draft");

    expect(en.productStatus.published).toBe("Active");
    expect(trigger()).toHaveTextContent(en.productStatus.draft);
    fireEvent.keyDown(trigger(), { key: "Enter" });

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      `${en.productStatus.published}${t.statusPublishedHint}`,
      `${en.productStatus.draft}${t.statusDraftHint}`,
      `${en.productStatus.unlisted}${t.statusUnlistedHint}`,
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("posts the chosen status under the same name as before", async () => {
    const { container } = renderCard("draft");
    expect(formData(container).get("status")).toBe("draft");

    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Unlisted/ }));

    expect(formData(container).get("status")).toBe("unlisted");
    expect(trigger()).toHaveTextContent(en.productStatus.unlisted);
  });

  it.each(["archived", "scheduled"])("renders no picker for a %s product", (status) => {
    const { container } = renderCard(status);

    expect(screen.queryByRole("button", { name: /^Status/ })).not.toBeInTheDocument();
    expect(formData(container).get("status")).toBeNull();
    expect(screen.getByText(t.statusLocked)).toBeInTheDocument();
    expect(
      screen.getByText((en.productStatus as Record<string, string>)[status]!),
    ).toBeInTheDocument();
  });
});
