import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { ResourcePicker } from "./resource-picker";

describe("ResourcePicker", () => {
  it("searches, lets the merchant tick results, and adds them on Done", async () => {
    const search = vi.fn().mockResolvedValue({
      outcome: "ok",
      items: [
        { id: "p-1", label: "Sneaker", detail: "SNK-1" },
        { id: "p-2", label: "Boot", detail: null },
      ],
    });
    const onChange = vi.fn();
    render(
      <ResourcePicker
        title={en.discounts.form.specificProducts}
        searchLabel={en.discounts.form.searchProducts}
        selected={[]}
        onChange={onChange}
        search={search}
        t={en}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.browse }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Sneaker/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: en.discounts.form.pickerDone }));

    expect(onChange).toHaveBeenCalledWith([{ id: "p-1", label: "Sneaker" }]);
  });

  it("opens the dialog with what was typed in the field", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn().mockResolvedValue({ outcome: "ok", items: [] });
    render(
      <ResourcePicker
        title="Products"
        searchLabel={en.discounts.form.searchProducts}
        selected={[]}
        onChange={vi.fn()}
        search={search}
        t={en}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: en.discounts.form.searchProducts }), {
      target: { value: "boo" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(search).toHaveBeenLastCalledWith("boo");
    expect(await screen.findByText(en.discounts.form.pickerEmpty)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("lists the picked items with a remove button each", () => {
    const onChange = vi.fn();
    render(
      <ResourcePicker
        title="Products"
        searchLabel={en.discounts.form.searchProducts}
        selected={[
          { id: "p-1", label: "Sneaker" },
          { id: "p-2", label: "Boot" },
        ]}
        onChange={onChange}
        search={vi.fn()}
        t={en}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Sneaker" }));
    expect(onChange).toHaveBeenCalledWith([{ id: "p-2", label: "Boot" }]);
  });

  it("says when the search fails", async () => {
    render(
      <ResourcePicker
        title="Products"
        searchLabel={en.discounts.form.searchProducts}
        selected={[]}
        onChange={vi.fn()}
        search={vi.fn().mockResolvedValue({ outcome: "error" })}
        t={en}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.browse }));
    expect(await screen.findByText(en.discounts.form.pickerError)).toBeInTheDocument();
  });
});
