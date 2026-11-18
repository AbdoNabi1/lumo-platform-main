import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { AbandonedCheckoutTimeline } from "./abandoned-checkout-timeline";

describe("AbandonedCheckoutTimeline", () => {
  it("lists the recovery (linking the order), link activity and the start", () => {
    render(
      <AbandonedCheckoutTimeline
        detail={{
          createdAt: "2026-10-18T09:00:00.000Z",
          lastActivityAt: "2026-10-18T09:00:00.000Z",
          links: [
            {
              issuedAt: "2026-10-18T12:00:00.000Z",
              expiresAt: "x",
              claimCount: 1,
              lastClaimedAt: "2026-10-18T13:00:00.000Z",
            },
          ],
          recoveredOrder: { id: "order-9", orderNumber: "1007" },
        }}
        t={en}
        locale="en"
      />,
    );
    const t = en.abandonedCheckouts.timeline;
    expect(
      screen.getByRole("link", { name: t.recovered.replace("{order}", "#1007") }),
    ).toHaveAttribute("href", "/orders/order-9");
    expect(screen.getByText(t.linkOpened.replace("{count}", "1"))).toBeInTheDocument();
    expect(screen.getByText(t.linkIssued)).toBeInTheDocument();
    expect(screen.getByText(t.started)).toBeInTheDocument();
  });
});
