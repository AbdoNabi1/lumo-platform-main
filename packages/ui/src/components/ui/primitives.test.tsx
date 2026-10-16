import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Input } from "./input";
import { Label } from "./label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

/**
 * Behavioural guarantees of the Morbeh primitives — the parts a redesign could silently
 * break: correct element semantics, the accessible state a control exposes, and the fact
 * that every primitive still resolves its colour through design tokens rather than a
 * literal.
 */

describe("Button", () => {
  it("renders a real button element by default", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("renders the child element under asChild, keeping link semantics for links", () => {
    render(
      <Button asChild>
        <a href="/orders">Orders</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Orders" });
    expect(link).toHaveAttribute("href", "/orders");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("announces and enforces the loading state", () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  it("does not claim to be busy when it is not loading", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-busy");
  });

  it("keeps an explicit disabled prop when not loading", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("styles every variant from tokens, never a literal colour", () => {
    const variants = ["primary", "secondary", "outline", "ghost", "destructive", "link"] as const;
    for (const variant of variants) {
      const { container, unmount } = render(<Button variant={variant}>x</Button>);
      expect(container.firstElementChild?.className).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
      unmount();
    }
  });
});

describe("Badge", () => {
  it("maps each status variant onto its semantic token pair", () => {
    const cases = [
      ["success", "bg-success-subtle"],
      ["warning", "bg-warning-subtle"],
      ["destructive", "bg-destructive-subtle"],
      ["info", "bg-info-subtle"],
      ["accent", "bg-primary-subtle"],
      ["neutral", "bg-secondary"],
    ] as const;

    for (const [variant, expectedClass] of cases) {
      const { container, unmount } = render(<Badge variant={variant}>Paid</Badge>);
      expect(container.firstElementChild).toHaveClass(expectedClass);
      unmount();
    }
  });
});

describe("Card", () => {
  it("exposes its title as a heading", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
        </CardHeader>
        <CardContent>body</CardContent>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Recent orders", level: 3 })).toBeInTheDocument();
  });

  it("honours an overridden heading level", () => {
    render(<CardTitle as="h2">Sales overview</CardTitle>);
    expect(screen.getByRole("heading", { name: "Sales overview", level: 2 })).toBeInTheDocument();
  });
});

describe("Input + Label", () => {
  it("associates the label with the control", () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" />
      </>,
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("Table", () => {
  it("puts wide tables in a labelled, keyboard-reachable scroll region", () => {
    render(
      <Table aria-label="Top products">
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Morbeh Chair Pro</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const region = screen.getByRole("region", { name: "Top products" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
    expect(screen.getByRole("columnheader", { name: "Product" })).toHaveAttribute("scope", "col");
  });
});
