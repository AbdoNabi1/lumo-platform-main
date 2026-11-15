import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { DnsTargetDto, ShopDomainDto } from "@/lib/domains/model";
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
const apexCustom = domain({
  id: "d-apex",
  hostname: "example.com",
  kind: "custom",
  status: "pending",
  isPrimary: false,
  verifiedAt: null,
});

/** What the runtime's DNS verifier accepts (`STOREFRONT_CNAME_TARGET` / `STOREFRONT_IPV4`). */
const TARGET: DnsTargetDto = {
  cname: "shops.morbeh.store",
  ipv4: ["203.0.113.10", "203.0.113.11"],
};

const t = en.domainsPage;

describe("DomainsView", () => {
  it("shows an empty state, and still offers to connect a domain", () => {
    render(<DomainsView domains={[]} dnsTarget={TARGET} t={en} />);

    expect(screen.getByText(t.empty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.connect })).toBeInTheDocument();
  });

  it("lists the platform subdomain as connected and primary, with a copy-link button", () => {
    render(<DomainsView domains={[platform]} dnsTarget={TARGET} t={en} />);

    const row = screen.getByRole("row", { name: new RegExp(platform.hostname) });
    expect(within(row).getByText(t.typePlatform)).toBeInTheDocument();
    expect(within(row).getByText(t.statusConnected)).toBeInTheDocument();
    expect(within(row).getByText(t.primary)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t.copyLink })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t.verify })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t.makePrimary })).not.toBeInTheDocument();
  });

  it("asks a pending subdomain for a CNAME to the verifier's target, never the platform address", () => {
    render(<DomainsView domains={[platform, pendingCustom]} dnsTarget={TARGET} t={en} />);

    const row = screen.getByRole("row", { name: /shop\.example\.com/ });
    expect(within(row).getByText(t.typeCustom)).toBeInTheDocument();
    expect(within(row).getByText(t.statusPending)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t.verify })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t.makePrimary })).not.toBeInTheDocument();

    const setup = screen.getByRole("region", { name: /shop\.example\.com/ });
    expect(setup).toHaveTextContent(
      "Add a CNAME record for shop.example.com pointing to shops.morbeh.store.",
    );
    expect(setup).toHaveTextContent(t.setupVerify);
    expect(setup).not.toHaveTextContent("A record");
    expect(setup).not.toHaveTextContent("lumo.morbeh.test");
  });

  it("asks an apex domain for an A record to the storefront IPs", () => {
    render(<DomainsView domains={[platform, apexCustom]} dnsTarget={TARGET} t={en} />);

    const setup = screen.getByRole("region", { name: /example\.com/ });
    expect(setup).toHaveTextContent(
      "Add an A record for example.com pointing to 203.0.113.10, 203.0.113.11.",
    );
    expect(setup).not.toHaveTextContent("CNAME");
  });

  it("shows both records when the host could be a subdomain or an apex", () => {
    const unsure = { ...pendingCustom, id: "d-eg", hostname: "example.com.eg" };
    render(<DomainsView domains={[unsure]} dnsTarget={TARGET} t={en} />);

    const setup = screen.getByRole("region", { name: /example\.com\.eg/ });
    expect(setup).toHaveTextContent("Add a CNAME record for example.com.eg pointing to");
    expect(setup).toHaveTextContent("Add an A record for example.com.eg pointing to");
  });

  it("says to contact support instead of a wrong target when none is configured", () => {
    render(
      <DomainsView
        domains={[platform, pendingCustom, apexCustom]}
        dnsTarget={{ cname: null, ipv4: [] }}
        t={en}
      />,
    );

    for (const name of [/shop\.example\.com/, /^Finish connecting example\.com$/]) {
      const setup = screen.getByRole("region", { name });
      expect(setup).toHaveTextContent(t.setupContactSupport);
      expect(setup).not.toHaveTextContent("pointing to");
      expect(setup).not.toHaveTextContent(t.setupVerify);
    }
  });

  it("offers Make primary for a connected non-primary custom domain, with no instructions", () => {
    render(<DomainsView domains={[platform, verifiedCustom]} dnsTarget={TARGET} t={en} />);

    const row = screen.getByRole("row", { name: /www\.lumo\.com/ });
    expect(within(row).getByRole("button", { name: t.makePrimary })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Finish connecting/ })).not.toBeInTheDocument();
  });

  it("verifies a pending domain through the action with its id", async () => {
    render(<DomainsView domains={[platform, pendingCustom]} dnsTarget={TARGET} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: t.verify }));

    await waitFor(() => expect(verifyDomainAction).toHaveBeenCalledTimes(1));
    expect(verifyDomainAction.mock.calls[0]?.[1].get("domainId")).toBe("d-custom");
  });

  it("makes a connected domain primary through the action with its id", async () => {
    render(<DomainsView domains={[platform, verifiedCustom]} dnsTarget={TARGET} t={en} />);

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
    render(<DomainsView domains={[platform, pendingCustom]} dnsTarget={TARGET} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: t.verify }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t.errorDnsNotReady);
  });

  it("opens an inline form to connect a domain and submits the hostname", async () => {
    render(<DomainsView domains={[platform]} dnsTarget={TARGET} t={en} />);
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
    render(<DomainsView domains={[platform]} dnsTarget={TARGET} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: t.connect }));
    fireEvent.change(screen.getByLabelText(t.hostname), { target: { value: "taken.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: t.connectSubmit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t.errorAlreadyConnected);
  });

  it("renders in Arabic", () => {
    const copy = ar.domainsPage;
    render(<DomainsView domains={[platform, pendingCustom]} dnsTarget={TARGET} t={ar} />);

    expect(screen.getByRole("button", { name: copy.connect })).toBeInTheDocument();
    expect(screen.getByText(copy.typePlatform)).toBeInTheDocument();
    expect(screen.getByText(copy.statusPending)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.verify })).toBeInTheDocument();
    const setup = screen.getByRole("region", { name: /shop\.example\.com/ });
    expect(setup).toHaveTextContent("shop.example.com");
    expect(setup).toHaveTextContent("shops.morbeh.store");
    expect(setup).toHaveTextContent("CNAME");
    expect(setup).toHaveTextContent(copy.setupVerify);
    expect(setup).not.toHaveTextContent("lumo.morbeh.test");
    expect(setup).not.toHaveTextContent("{");
    expect(copy.connect).not.toBe(t.connect);
  });

  it("renders the Arabic A-record and contact-support lines", () => {
    const copy = ar.domainsPage;
    render(<DomainsView domains={[apexCustom]} dnsTarget={TARGET} t={ar} />);
    const apex = screen.getByRole("region", { name: /example\.com/ });
    expect(apex).toHaveTextContent("203.0.113.10, 203.0.113.11");
    expect(apex).not.toHaveTextContent("{");
    cleanup();

    render(<DomainsView domains={[apexCustom]} dnsTarget={{ cname: null, ipv4: [] }} t={ar} />);
    expect(screen.getByRole("region", { name: /example\.com/ })).toHaveTextContent(
      copy.setupContactSupport,
    );
  });
});
