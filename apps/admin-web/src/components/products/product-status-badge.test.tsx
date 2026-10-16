import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { ProductStatusBadge } from "./product-status-badge";

describe("ProductStatusBadge", () => {
  it("renders the unlisted status in both locales", () => {
    const { rerender } = render(<ProductStatusBadge status="unlisted" t={en} />);
    expect(screen.getByText(en.productStatus.unlisted)).toBeInTheDocument();
    rerender(<ProductStatusBadge status="unlisted" t={ar} />);
    expect(screen.getByText(ar.productStatus.unlisted)).toBeInTheDocument();
  });

  it("calls a published product Active", () => {
    render(<ProductStatusBadge status="published" t={en} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
