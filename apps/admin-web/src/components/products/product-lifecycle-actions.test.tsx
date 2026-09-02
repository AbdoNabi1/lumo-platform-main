import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { ProductLifecycleActions } from "./product-lifecycle-actions";

const publishProductAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const schedulePublishProductAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const unpublishProductAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const archiveProductAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const deleteProductAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();

vi.mock("@/app/products/actions", () => ({
  publishProductAction: (previous: FormState, formData: FormData) =>
    publishProductAction(previous, formData),
  schedulePublishProductAction: (previous: FormState, formData: FormData) =>
    schedulePublishProductAction(previous, formData),
  unpublishProductAction: (previous: FormState, formData: FormData) =>
    unpublishProductAction(previous, formData),
  archiveProductAction: (previous: FormState, formData: FormData) =>
    archiveProductAction(previous, formData),
  deleteProductAction: (previous: FormState, formData: FormData) =>
    deleteProductAction(previous, formData),
}));

beforeEach(() => {
  publishProductAction.mockReset();
  schedulePublishProductAction.mockReset();
  unpublishProductAction.mockReset();
  archiveProductAction.mockReset();
  deleteProductAction.mockReset();
});

describe("ProductLifecycleActions", () => {
  it("offers publish, schedule, archive, and delete for a draft product", () => {
    render(<ProductLifecycleActions productId="product-1" status="draft" t={en} />);

    expect(screen.getByRole("button", { name: en.productLifecycle.publish })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.productLifecycle.schedulePublish }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.productLifecycle.archive })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.productLifecycle.delete })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.productLifecycle.unpublish }),
    ).not.toBeInTheDocument();
  });

  it("offers only unpublish and archive for a published product — never delete or publish again", () => {
    render(<ProductLifecycleActions productId="product-1" status="published" t={en} />);

    expect(screen.getByRole("button", { name: en.productLifecycle.unpublish })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.productLifecycle.archive })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.productLifecycle.publish }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.productLifecycle.delete }),
    ).not.toBeInTheDocument();
  });

  it("offers only delete for an archived product", () => {
    render(<ProductLifecycleActions productId="product-1" status="archived" t={en} />);

    expect(screen.getByRole("button", { name: en.productLifecycle.delete })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.productLifecycle.publish }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.productLifecycle.unpublish }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.productLifecycle.archive }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing for an unrecognized status rather than guessing", () => {
    const { container } = render(
      <ProductLifecycleActions productId="product-1" status="weird-status" t={en} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
