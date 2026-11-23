import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FormState } from "@/lib/api/mutation";
import { en } from "@/messages/en";

const action = vi.hoisted(() => ({ changeLeadStatusAction: vi.fn() }));
vi.mock("@/app/leads/actions", () => ({
  changeLeadStatusAction: action.changeLeadStatusAction,
}));

const { LeadStatusForm } = await import("./lead-status-form");

beforeEach(() => {
  expect.hasAssertions();
  action.changeLeadStatusAction.mockReset();
});

describe("LeadStatusForm", () => {
  it("posts the lead id and the chosen status once per submit", async () => {
    action.changeLeadStatusAction.mockResolvedValue({ status: "success" } satisfies FormState);
    render(<LeadStatusForm leadId="lead-1" status="new" canEdit t={en} />);

    const select = screen.getByLabelText(en.leadDetail.statusLabel);
    expect(select).toHaveValue("new");
    fireEvent.change(select, { target: { value: "contacted" } });
    fireEvent.click(screen.getByRole("button", { name: en.leadDetail.save }));

    await waitFor(() => expect(action.changeLeadStatusAction).toHaveBeenCalledTimes(1));
    const formData = action.changeLeadStatusAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("leadId")).toBe("lead-1");
    expect(formData.get("status")).toBe("contacted");
  });

  it("offers all six statuses with their labels", () => {
    render(<LeadStatusForm leadId="lead-1" status="new" canEdit t={en} />);
    const options = [
      ...screen.getByLabelText(en.leadDetail.statusLabel).querySelectorAll("option"),
    ];
    expect(options.map((o) => o.textContent)).toEqual([
      en.leadStatus.new,
      en.leadStatus.contacted,
      en.leadStatus.qualified,
      en.leadStatus.converted,
      en.leadStatus.rejected,
      en.leadStatus.spam,
    ]);
  });

  it("announces success with role=status", async () => {
    action.changeLeadStatusAction.mockResolvedValue({ status: "success" } satisfies FormState);
    render(<LeadStatusForm leadId="lead-1" status="new" canEdit t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.leadDetail.save }));

    expect(await screen.findByRole("status")).toHaveTextContent(en.leadDetail.saved);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces a failure with role=alert", async () => {
    action.changeLeadStatusAction.mockResolvedValue({
      status: "error",
      message: "That didn't go through — try again.",
      fieldErrors: {},
    } satisfies FormState);
    render(<LeadStatusForm leadId="lead-1" status="new" canEdit t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.leadDetail.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That didn't go through — try again.",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is read-only for a viewer: the status as a badge, no select, no save", () => {
    render(<LeadStatusForm leadId="lead-1" status="qualified" canEdit={false} t={en} />);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(en.leadStatus.qualified)).toBeInTheDocument();
    expect(screen.getByText(en.leadDetail.readOnly)).toBeInTheDocument();
  });
});
