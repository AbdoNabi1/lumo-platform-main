import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ShopDomainDto } from "@/lib/domains/model";
import { DomainsView } from "./domains-view";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const addDomainAction = vi.fn<Action>();
const verifyDomainAction = vi.fn<Action>();
const makeDomainPrimaryAction = vi.fn<Action>();

vi.mock("@/app/settings/domains/actions", () => ({
  addDomainAction: (previous: FormState, formData: FormData) => addDomainAction(previous, formData),
  verifyDomainAction: (previous: FormState, formData: FormData) =>
    verifyDomainAction(previous, formData),
  makeDomainPrimaryAction: (previous: FormState, formData: FormData) =>
    makeDomainPrimaryAction(previous, formData),
}));

beforeEach(() => {
  addDomainAction.mockReset().mockResolvedValue({ status: "success" });
  verifyDomainAction.mockReset().mockResolvedValue({ status: "success" });
  makeDomainPrimaryAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function domain(overrides: Partial<ShopDomainDto>): ShopDomainDto {
  return {
    id: "d-platform",
    shopId: "s1",
    hostname: "lumo.morbeh.test",
    kind: "platform",
    status: "verified",
    isPrimary: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const platform = domain({});
const pendingCustom = domain({
  id: "d-custom",
  hostname: "shop.example.com",
  kind: "custom",
  status: "pending",
  isPrimary: false,
  verifiedAt: null,
});
const verifiedCustom = domain({
  id: "d-verified",
  hostname: "www.lumo.com",
  kind: "custom",
  status: "verified",
  isPrimary: false,
});

const t = en.domainsPage;

describe("DomainsView", () => {
  it("shows an empty state, and still offers to connect a domain", () => {
    render(<DomainsView domains={[]} t={en} />);

    expect(screen.getByText(t.empty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.connect })).toBeInTheDocument();
  });

  it("lists the platform subdomain as connected and primary, with a copy-link button", () => {
    render(<DomainsView domains={[platform]} t={en} />);

    const row = screen.getByRole("row", { name: new RegExp(platform.hostname) });
    expect(within(row).getByText(t.typePlatform)).toBeInTheDocument();
    expect(within(row).getByText(t.statusConnected)).toBeInTheDocument();
    expect(within(row).getByText(t.primary)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t.copyLink })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t.verify })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t.makePrimary })).not.toBeInTheDocument();
  });

  it("shows a pending custom domain with Verify and setup instructions naming the platform address", () => {
    render(<DomainsView domains={[platform, pendingCustom]} t={en} />);

    const row = screen.getByRole("row", { name: /shop\.example\.com/ });
    expect(within(row).getByText(t.typeCustom)).toBeInTheDocument();
    expect(within(row).getByText(t.statusPending)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t.verify })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t.makePrimary })).not.toBeInTheDocument();

    const setup = screen.getByRole("region", { name: /shop\.example\.com/ });
    expect(setup).toHaveTextContent(
      "Add a CNAME record for shop.example.com pointing to lumo.morbeh.test, then press Verify. DNS can take up to 48 hours.",
    );
  });

  it("falls back to 'your Morbeh address' when the list has no platform domain", () => {
    render(<DomainsView domains={[pendingCustom]} t={en} />);

    expect(screen.getByRole("region", { name: /shop\.example\.com/ })).toHaveTextContent(
      `pointing to ${t.setupTargetFallback},`,
    );
  });

  it("offers Make primary for a connected non-primary custom domain, with no instructions", () => {
    render(<DomainsView domains={[platform, verifiedCustom]} t={en} />);

    const row = screen.getByRole("row", { name: /www\.lumo\.com/ });
    expect(within(row).getByRole("button", { name: t.makePrimary })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Finish connecting/ })).not.toBeInTheDocument();
  });

  it("verifies a pending domain through the action with its id", async () => {
    render(<DomainsView domains={[platform, pendingCustom]} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: t.verify }));

    await waitFor(() => expect(verifyDomainAction).toHaveBeenCalledTimes(1));
    expect(verifyDomainAction.mock.calls[0]?.[1].get("domainId")).toBe("d-custom");
  });

  it("makes a connected domain primary through the action with its id", async () => {
    render(<DomainsView domains={[platform, verifiedCustom]} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: t.makePrimary }));

    await waitFor(() => expect(makeDomainPrimaryAction).toHaveBeenCalledTimes(1));
    expect(makeDomainPrimaryAction.mock.calls[0]?.[1].get("domainId")).toBe("d-verified");
  });

  it("shows the reason when verification is refused", async () => {
    verifyDomainAction.mockResolvedValue({
      status: "error",
      message: t.errorDnsNotReady,
      fieldErrors: {},
    });
    render(<DomainsView domains={[platform, pendingCustom]} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: t.verify }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t.errorDnsNotReady);
  });

  it("opens an inline form to connect a domain and submits the hostname", async () => {
    render(<DomainsView domains={[platform]} t={en} />);
    expect(screen.queryByLabelText(t.hostname)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t.connect }));
    fireEvent.change(screen.getByLabelText(t.hostname), { target: { value: "shop.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: t.connectSubmit }));

    await waitFor(() => expect(addDomainAction).toHaveBeenCalledTimes(1));
    expect(addDomainAction.mock.calls[0]?.[1].get("hostname")).toBe("shop.example.com");
  });

  it("shows the already-connected message under the form", async () => {
    addDomainAction.mockResolvedValue({
      status: "error",
      message: t.errorAlreadyConnected,
      fieldErrors: {},
    });
    render(<DomainsView domains={[platform]} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: t.connect }));
    fireEvent.change(screen.getByLabelText(t.hostname), { target: { value: "taken.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: t.connectSubmit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t.errorAlreadyConnected);
  });

  it("renders in Arabic", () => {
    const copy = ar.domainsPage;
    render(<DomainsView domains={[platform, pendingCustom]} t={ar} />);

    expect(screen.getByRole("button", { name: copy.connect })).toBeInTheDocument();
    expect(screen.getByText(copy.typePlatform)).toBeInTheDocument();
    expect(screen.getByText(copy.statusPending)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.verify })).toBeInTheDocument();
    const setup = screen.getByRole("region", { name: /shop\.example\.com/ });
    expect(setup).toHaveTextContent("shop.example.com");
    expect(setup).toHaveTextContent("lumo.morbeh.test");
    expect(setup).not.toHaveTextContent("{");
    expect(copy.connect).not.toBe(t.connect);
  });
});
