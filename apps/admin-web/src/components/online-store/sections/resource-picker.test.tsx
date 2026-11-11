import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { ThemeTargetsDto } from "@/lib/api/online-store";

const actions = vi.hoisted(() => ({ searchLinkTargetsAction: vi.fn() }));
vi.mock("@/app/online-store/navigation/actions", () => actions);
const { ResourcePicker } = await import("./resource-picker");
const { LINK_SEARCH_DEBOUNCE_MS } = await import("../link-picker");

const p = en.onlineStoreSections.picker;

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  actions.searchLinkTargetsAction.mockReset();
});

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const result = (id: string, title: string) => ({ id, title, subtitle: `/x/${id}` });

function Stateful({
  initial = [],
  kind = "product",
  multiple = true,
  max = 3,
  targets = null,
  onTarget = vi.fn(),
  onChange = vi.fn(),
}: {
  initial?: string[];
  kind?: "collection" | "product";
  multiple?: boolean;
  max?: number;
  targets?: ThemeTargetsDto | null;
  onTarget?: (kind: "collection" | "product", id: string, title: string) => void;
  onChange?: (ids: readonly string[]) => void;
}) {
  const [value, setValue] = useState<readonly string[]>(initial);
  return (
    <ResourcePicker
      t={en}
      locale="en"
      id="rp"
      label="Products"
      kind={kind}
      multiple={multiple}
      max={max}
      value={value}
      targets={targets}
      disabled={false}
      onChange={(ids) => {
        onChange(ids);
        setValue(ids);
      }}
      onTarget={onTarget}
    />
  );
}

const targetsOf = (titles: Record<string, string>): ThemeTargetsDto => ({
  collection: {},
  page: {},
  product: Object.fromEntries(
    Object.entries(titles).map(([id, title]) => [id, { title, live: true }]),
  ),
});

describe("ResourcePicker", () => {
  it("debounced, and nothing after unmount: typing 'sal' searches once after 250 ms", async () => {
    vi.useFakeTimers();
    actions.searchLinkTargetsAction.mockResolvedValue([]);
    render(<Stateful kind="collection" multiple={false} max={1} />);
    const box = screen.getByRole("searchbox");
    for (const q of ["s", "sa", "sal"]) fireEvent.change(box, { target: { value: q } });
    await tick(LINK_SEARCH_DEBOUNCE_MS - 1);
    expect(actions.searchLinkTargetsAction).not.toHaveBeenCalled();
    await tick(1);
    expect(actions.searchLinkTargetsAction).toHaveBeenCalledTimes(1);
    expect(actions.searchLinkTargetsAction).toHaveBeenCalledWith("collection", "sal");
  });

  it("unmounting before the pause calls the action never", async () => {
    vi.useFakeTimers();
    actions.searchLinkTargetsAction.mockResolvedValue([]);
    const { unmount } = render(<Stateful />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sal" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS - 50);
    unmount();
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    expect(actions.searchLinkTargetsAction).not.toHaveBeenCalled();
  });

  it("a stale answer never replaces a newer one", async () => {
    vi.useFakeTimers();
    let answerFirst: (v: unknown) => void = () => undefined;
    actions.searchLinkTargetsAction
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce([result("p-2", "Sandals")]);
    render(<Stateful />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "s" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sa" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: /Sandals/ })).toBeInTheDocument();
    await act(async () => {
      answerFirst([result("p-1", "Shirts")]);
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: /Shirts/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Sandals/ })).toBeInTheDocument();
  });

  it("an answer that lands after unmount is ignored", async () => {
    vi.useFakeTimers();
    let answer: (v: unknown) => void = () => undefined;
    actions.searchLinkTargetsAction.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = render(<Stateful />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "s" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    unmount();
    await act(async () => {
      answer([result("p-1", "Shirts")]);
      await Promise.resolve();
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("picking adds a chip titled by the pick, and reports the kind, id and title", async () => {
    vi.useFakeTimers();
    actions.searchLinkTargetsAction.mockResolvedValue([result("p-1", "Shirts")]);
    const onTarget = vi.fn();
    const onChange = vi.fn();
    render(<Stateful onTarget={onTarget} onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "s" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: /Shirts/ }));
    expect(onTarget).toHaveBeenCalledWith("product", "p-1", "Shirts");
    expect(onChange).toHaveBeenLastCalledWith(["p-1"]);
    expect(
      screen.getByRole("button", { name: p.removeChip.replace("{name}", "Shirts") }),
    ).toBeInTheDocument();
    // A chosen result cannot be picked twice.
    expect(screen.getByRole("button", { name: /Shirts/, pressed: true })).toBeDisabled();
  });

  it("chips are titled from the draft's targets", () => {
    render(<Stateful initial={["p-7"]} targets={targetsOf({ "p-7": "Hat" })} />);
    expect(
      screen.getByRole("button", { name: p.removeChip.replace("{name}", "Hat") }),
    ).toBeInTheDocument();
  });

  it("the multi picker stops at max", async () => {
    vi.useFakeTimers();
    actions.searchLinkTargetsAction.mockResolvedValue([
      result("p-3", "Third"),
      result("p-4", "Fourth"),
    ]);
    render(<Stateful initial={["p-1", "p-2"]} max={3} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "t" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: /Third/ }));
    // Full: the search box and every remaining result are disabled.
    expect(screen.getByRole("searchbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Fourth/ })).toBeDisabled();
    expect(screen.getByText(/Up to 3\./)).toBeInTheDocument();
  });

  it("a single picker replaces its pick", async () => {
    vi.useFakeTimers();
    actions.searchLinkTargetsAction.mockResolvedValue([result("c-2", "Sale")]);
    const onChange = vi.fn();
    render(
      <Stateful kind="collection" multiple={false} max={1} initial={["c-1"]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "s" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: /Sale/ }));
    expect(onChange).toHaveBeenLastCalledWith(["c-2"]);
  });

  it("removing a chip focuses the next chip, or the search box", () => {
    render(<Stateful initial={["p-1", "p-2", "p-3"]} />);
    const remove = (name: string) =>
      screen.getByRole("button", { name: p.removeChip.replace("{name}", name) });
    const first = remove("p-1");
    first.focus();
    fireEvent.click(first);
    expect(document.activeElement).toBe(remove("p-2"));
    const last = remove("p-3");
    last.focus();
    fireEvent.click(last);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    expect(
      screen.queryByRole("button", { name: p.removeChip.replace("{name}", "p-3") }),
    ).toBeNull();
  });

  it("clearing the box shows nothing and does not search", async () => {
    vi.useFakeTimers();
    render(<Stateful />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "s" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await tick(LINK_SEARCH_DEBOUNCE_MS * 2);
    expect(actions.searchLinkTargetsAction).not.toHaveBeenCalled();
  });
});
