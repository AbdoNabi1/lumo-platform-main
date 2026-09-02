import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { StatePanel } from "./state-panel";

describe("StatePanel", () => {
  it("renders the not-found title and body", () => {
    render(
      <StatePanel
        icon={<span />}
        title={en.product.notFoundTitle}
        body={en.product.notFoundBody}
      />,
    );
    expect(screen.getByRole("heading", { name: en.product.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByText(en.product.notFoundBody)).toBeInTheDocument();
  });

  it("renders an action link back to the shop when provided", () => {
    render(
      <StatePanel
        icon={<span />}
        title={en.collection.errorTitle}
        body={en.collection.errorBody}
        action={{ href: "/", label: en.collection.backToShop }}
      />,
    );
    expect(screen.getByRole("link", { name: en.collection.backToShop })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders no action link when none is provided", () => {
    render(<StatePanel icon={<span />} title={en.notFound.title} body={en.notFound.body} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
