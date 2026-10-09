import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { LocationsCard } from "./locations-card";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const addLocationAction = vi.fn<Action>();
const deactivateLocationAction = vi.fn<Action>();

vi.mock("@/app/inventory/actions", () => ({
  addLocationAction: (previous: FormState, formData: FormData) =>
    addLocationAction(previous, formData),
  deactivateLocationAction: (previous: FormState, formData: FormData) =>
    deactivateLocationAction(previous, formData),
}));

const t = en.inventoryPage;

const locations = [
  { id: "wh-id-1111", code: "SHOP", name: "Main shop", status: "active" },
  { id: "wh-id-2222", code: "NASR-CITY", name: "Nasr City", status: "active" },
  { id: "wh-id-3333", code: "OLD", name: "Old store", status: "inactive" },
];

beforeEach(() => {
  addLocationAction.mockReset().mockResolvedValue({ status: "success" });
  deactivateLocationAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LocationsCard", () => {
  it("lists each location by name, with its code and a status badge, and no raw ids", () => {
    const { container } = render(<LocationsCard locations={locations} t={en} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Main shop")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("SHOP")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(t.statusActive)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(t.statusInactive)).toBeInTheDocument();
    expect(container.textContent).not.toContain("wh-id-");
  });

  it("says so when there are no locations yet", () => {
    render(<LocationsCard locations={[]} t={en} />);

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByText(t.noLocations)).toBeInTheDocument();
  });

  it("adds a location by name only", async () => {
    render(<LocationsCard locations={locations} t={en} />);

    fireEvent.change(screen.getByLabelText(t.locationNameLabel), { target: { value: "Giza" } });
    fireEvent.click(screen.getByRole("button", { name: t.addLocation }));

    await waitFor(() => expect(addLocationAction).toHaveBeenCalledTimes(1));
    const formData = addLocationAction.mock.calls[0]![1];
    expect(formData.get("name")).toBe("Giza");
    expect(formData.has("code")).toBe(false);
  });

  it("offers Deactivate only on active locations", () => {
    render(<LocationsCard locations={locations} t={en} />);

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByRole("button", { name: t.deactivate })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("button", { name: t.deactivate })).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("button", { name: t.deactivate })).not.toBeInTheDocument();
  });

  it("asks before deactivating, then posts that row's id", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LocationsCard locations={locations} t={en} />);

    fireEvent.click(
      within(screen.getAllByRole("listitem")[1]!).getByRole("button", { name: t.deactivate }),
    );

    expect(confirm).toHaveBeenCalledWith(t.confirmDeactivate);
    await waitFor(() => expect(deactivateLocationAction).toHaveBeenCalledTimes(1));
    expect(deactivateLocationAction.mock.calls[0]![1].get("warehouseId")).toBe("wh-id-2222");
  });

  it("does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LocationsCard locations={locations} t={en} />);

    fireEvent.click(
      within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: t.deactivate }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deactivateLocationAction).not.toHaveBeenCalled();
  });

  it("shows the server's message when adding fails", async () => {
    addLocationAction.mockResolvedValue({
      status: "error",
      message: "Could not add the location.",
      fieldErrors: {},
    });
    render(<LocationsCard locations={locations} t={en} />);

    fireEvent.change(screen.getByLabelText(t.locationNameLabel), { target: { value: "Giza" } });
    fireEvent.click(screen.getByRole("button", { name: t.addLocation }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add the location.");
  });

  it("has every label in Arabic", () => {
    render(<LocationsCard locations={locations} t={ar} />);

    expect(screen.getByText(ar.inventoryPage.locationsTitle)).toBeInTheDocument();
    expect(screen.getAllByText(ar.inventoryPage.statusActive).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: ar.inventoryPage.addLocation })).toBeInTheDocument();
  });
});
