import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import { OrderTagsCard } from "./order-tags-card";

const actions = vi.hoisted(() => ({
  saveOrderNoteAction: vi.fn(),
  changeOrderTagsAction: vi.fn(),
  suggestOrderTagsAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

beforeEach(() => {
  actions.changeOrderTagsAction.mockReset();
  actions.suggestOrderTagsAction.mockReset().mockResolvedValue([]);
});

describe("OrderTagsCard (Shopify's Tags card)", () => {
  it("saves an added tag immediately and shows the order's tags the API answered", async () => {
    actions.changeOrderTagsAction.mockResolvedValue({ status: "saved", tags: ["urgent", "VIP"] });
    render(<OrderTagsCard orderId="o-1" tags={["VIP"]} canTag t={en} />);
    const input = screen.getByLabelText("Add tags");
    fireEvent.change(input, { target: { value: "urgent" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(actions.changeOrderTagsAction).toHaveBeenCalledWith("o-1", { add: ["urgent"] }),
    );
    expect(await screen.findByRole("button", { name: "Remove urgent" })).toBeInTheDocument();
  });

  it("removes a tag with its ×", async () => {
    actions.changeOrderTagsAction.mockResolvedValue({ status: "saved", tags: [] });
    render(<OrderTagsCard orderId="o-1" tags={["VIP"]} canTag t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    await waitFor(() =>
      expect(actions.changeOrderTagsAction).toHaveBeenCalledWith("o-1", { remove: ["VIP"] }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove VIP" })).toBeNull());
  });

  it("shows the refusal", async () => {
    actions.changeOrderTagsAction.mockResolvedValue({ status: "error", message: "Not allowed" });
    render(<OrderTagsCard orderId="o-1" tags={["VIP"]} canTag t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed");
  });

  it("a viewer sees the tags without any input or ×, or No tags", () => {
    const { rerender } = render(
      <OrderTagsCard orderId="o-1" tags={["VIP"]} canTag={false} t={en} />,
    );
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add tags")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove VIP" })).toBeNull();
    rerender(<OrderTagsCard orderId="o-1" tags={[]} canTag={false} t={en} />);
    expect(screen.getByText("No tags")).toBeInTheDocument();
  });
});
