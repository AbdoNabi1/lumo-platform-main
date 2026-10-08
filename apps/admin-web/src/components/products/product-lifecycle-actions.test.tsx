import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { ProductLifecycleActions } from "./product-lifecycle-actions";

const schedulePublishProductAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const archiveProductAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const deleteProductAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();

vi.mock("@/app/products/actions", () => ({
  schedulePublishProductAction: (previous: FormState, formData: FormData) =>
    schedulePublishProductAction(previous, formData),
  archiveProductAction: (previous: FormState, formData: FormData) =>
    archiveProductAction(previous, formData),
  deleteProductAction: (previous: FormState, formData: FormData) =>
    deleteProductAction(previous, formData),
}));

beforeEach(() => {
  schedulePublishProductAction.mockReset();
  archiveProductAction.mockReset();
  deleteProductAction.mockReset();
});

const button = (name: string) => screen.queryByRole("button", { name });

describe("ProductLifecycleActions", () => {
  it("offers schedule, archive and delete for a draft — no publish or unpublish any more", () => {
    render(<ProductLifecycleActions productId="product-1" status="draft" t={en} />);

    expect(screen.getByText(en.productEditor.moreActions)).toBeInTheDocument();
    expect(button(en.productLifecycle.schedulePublish)).toBeInTheDocument();
    expect(button(en.productLifecycle.archive)).toBeInTheDocument();
    expect(button(en.productLifecycle.delete)).toBeInTheDocument();
    expect(button("Publish")).not.toBeInTheDocument();
    expect(button("Unpublish")).not.toBeInTheDocument();
  });

  it.each(["published", "unlisted", "scheduled"])(
    "offers only archive for a %s product — never delete or schedule",
    (status) => {
      render(<ProductLifecycleActions productId="product-1" status={status} t={en} />);

      expect(button(en.productLifecycle.archive)).toBeInTheDocument();
      expect(button(en.productLifecycle.delete)).not.toBeInTheDocument();
      expect(button(en.productLifecycle.schedulePublish)).not.toBeInTheDocument();
    },
  );

  it("offers only delete for an archived product", () => {
    render(<ProductLifecycleActions productId="product-1" status="archived" t={en} />);

    expect(button(en.productLifecycle.delete)).toBeInTheDocument();
    expect(button(en.productLifecycle.archive)).not.toBeInTheDocument();
    expect(button(en.productLifecycle.schedulePublish)).not.toBeInTheDocument();
  });

  it("renders nothing for an unrecognized status rather than guessing", () => {
    const { container } = render(
      <ProductLifecycleActions productId="product-1" status="weird-status" t={en} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
