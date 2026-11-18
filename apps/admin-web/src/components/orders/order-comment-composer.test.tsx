import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderCommentComposer } from "./order-comment-composer";

const actions = vi.hoisted(() => ({
  postOrderCommentAction: vi.fn(),
  editOrderCommentAction: vi.fn(),
  deleteOrderCommentAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

beforeEach(() => {
  actions.postOrderCommentAction.mockReset().mockResolvedValue({ status: "success" });
});

describe("OrderCommentComposer (Shopify's Leave a comment...)", () => {
  it("keeps Post disabled until something is written", () => {
    render(<OrderCommentComposer orderId="o-1" t={en} />);
    const post = screen.getByRole("button", { name: "Post" });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Leave a comment..."), {
      target: { value: "  " },
    });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Leave a comment..."), {
      target: { value: "Called" },
    });
    expect(post).toBeEnabled();
  });

  it("posts the order id and text, shows Posting… while it runs, and clears on success", async () => {
    let finish: (state: unknown) => void = () => undefined;
    actions.postOrderCommentAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<OrderCommentComposer orderId="o-1" t={en} />);
    const box = screen.getByPlaceholderText("Leave a comment...") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Called — no answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("button", { name: "Posting…" })).toBeDisabled();
    const formData = actions.postOrderCommentAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("orderId")).toBe("o-1");
    expect(formData.get("body")).toBe("Called — no answer");
    finish({ status: "success" });
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("shows a refusal and keeps the text", async () => {
    actions.postOrderCommentAction.mockResolvedValue({
      status: "error",
      message: "Your account doesn't have permission to do this.",
      fieldErrors: {},
    });
    render(<OrderCommentComposer orderId="o-1" t={en} />);
    const box = screen.getByPlaceholderText("Leave a comment...") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Called" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("permission");
    expect(box.value).toBe("Called");
  });

  it("is in Arabic on an Arabic page", () => {
    render(<OrderCommentComposer orderId="o-1" t={ar} />);
    expect(screen.getByPlaceholderText("اكتب تعليقًا...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "نشر" })).toBeInTheDocument();
  });

  it("follows the text's own direction while typing (dir=auto)", () => {
    render(<OrderCommentComposer orderId="o-1" t={en} />);
    expect(screen.getByPlaceholderText("Leave a comment...")).toHaveAttribute("dir", "auto");
  });
});
