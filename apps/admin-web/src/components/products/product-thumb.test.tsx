import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductThumb } from "./product-thumb";

describe("ProductThumb", () => {
  it("shows the picture at the given size, unoptimized, with its description", () => {
    render(<ProductThumb url="https://cdn.example.test/a.webp" alt="Red shoe" />);
    const img = screen.getByRole("img", { name: "Red shoe" });
    expect(img).toHaveAttribute("src", "https://cdn.example.test/a.webp");
    expect(img).toHaveAttribute("width", "40");
    expect(img).toHaveAttribute("height", "40");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it.each([null, undefined])("shows a placeholder, and no img, when the url is %s", (url) => {
    const { container } = render(<ProductThumb url={url} alt="Red shoe" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
