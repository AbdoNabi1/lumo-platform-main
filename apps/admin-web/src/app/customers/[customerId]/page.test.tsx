import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  fetchCustomer: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: mocks.readSession,
  highestRole: (roles: readonly string[]) =>
    (["admin", "operator", "viewer"] as const).find((role) => roles.includes(role)),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/platform-tools", () => ({ showPlatformTools: () => false }));
vi.mock("@/lib/api/customers", () => ({ fetchCustomer: mocks.fetchCustomer }));
vi.mock("@/lib/api/customer-360", () => ({
  fetchCustomerProfile: vi.fn(),
  fetchIdentityTimeline: vi.fn(),
}));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/customers/customer-addresses-card", () => ({
  CustomerAddressesCard: () => null,
}));
vi.mock("@/components/customers/customer-consent-card", () => ({
  CustomerConsentCard: () => null,
}));
vi.mock("@/components/customers/customer-identity-timeline-card", () => ({
  CustomerIdentityTimelineCard: () => null,
}));
vi.mock("@/components/customers/customer-orders-card", () => ({
  CustomerOrdersCard: () => null,
  CustomerOrdersCardSkeleton: () => null,
}));
vi.mock("@/components/customers/customer-profile-card", () => ({
  CustomerProfileCard: () => null,
}));
vi.mock("@/components/customers/customer-overview-card", () => ({
  CustomerOverviewCard: () => null,
}));
vi.mock("@/components/customers/customer-note-card", () => ({ CustomerNoteCard: () => null }));
vi.mock("@/components/customers/customer-tags-card", () => ({ CustomerTagsCard: () => null }));
vi.mock("@/components/customers/customer-marketing-card", () => ({
  CustomerMarketingCard: () => null,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { default: CustomerDetailPage } = await import("./page");
const { CustomerOverviewCard } = await import("@/components/customers/customer-overview-card");
const { CustomerNoteCard } = await import("@/components/customers/customer-note-card");
const { CustomerTagsCard } = await import("@/components/customers/customer-tags-card");
const { CustomerMarketingCard } = await import("@/components/customers/customer-marketing-card");

const customer = {
  id: "c-1",
  name: "Nour Hassan",
  email: "nour@example.com",
  addresses: [],
  consents: [],
  phone: "+201001234567",
  language: "ar",
  isGuest: false,
  note: "VIP",
  tags: ["Cairo"],
  marketing: { email: true, sms: false },
};

function findAll(node: ReactNode, match: (element: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [...(match(element) ? [element] : []), ...findAll(element.props.children, match)];
}

async function cardProps() {
  const tree = await CustomerDetailPage({ params: Promise.resolve({ customerId: "c-1" }) });
  const props = (type: unknown) =>
    findAll(tree, (element) => element.type === type)[0]?.props as Record<string, unknown>;
  return {
    overview: props(CustomerOverviewCard),
    note: props(CustomerNoteCard),
    tags: props(CustomerTagsCard),
    marketing: props(CustomerMarketingCard),
  };
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.readSession.mockReset();
  mocks.fetchCustomer.mockReset();
  mocks.fetchCustomer.mockResolvedValue({ outcome: "ok", customer });
});

describe("CustomerDetailPage", () => {
  it.each(["operator", "admin"])("%s gets canEdit on every editable card", async (role) => {
    mocks.readSession.mockResolvedValue({ roles: [role] });

    const cards = await cardProps();

    for (const props of Object.values(cards)) expect(props).toMatchObject({ canEdit: true });
  });

  it("a viewer, no session and an unknown role get canEdit false on every card", async () => {
    for (const session of [{ roles: ["viewer"] }, null, { roles: ["guest"] }]) {
      mocks.readSession.mockResolvedValue(session);

      const cards = await cardProps();

      for (const props of Object.values(cards)) expect(props).toMatchObject({ canEdit: false });
    }
  });

  it("hands each card its own slice of the customer", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["operator"] });

    const cards = await cardProps();

    expect(cards.overview).toMatchObject({ customer: { id: "c-1", phone: "+201001234567" } });
    expect(cards.note).toMatchObject({ customerId: "c-1", note: "VIP" });
    expect(cards.tags).toMatchObject({ customerId: "c-1", tags: ["Cairo"] });
    expect(cards.marketing).toMatchObject({
      customerId: "c-1",
      marketing: { email: true, sms: false },
    });
  });
});
