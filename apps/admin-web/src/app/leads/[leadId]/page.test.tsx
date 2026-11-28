import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as SessionModule from "@/lib/auth/session";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  locale: "en" as string | undefined,
  readSession: vi.fn(),
  fetchLead: vi.fn(),
}));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale === undefined ? undefined : { value: mocks.locale }),
    }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  readSession: mocks.readSession,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/leads", () => ({ fetchLead: mocks.fetchLead }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/leads/lead-status-form", () => ({ LeadStatusForm: () => null }));
const { default: LeadDetailPage } = await import("./page");

const LEAD = {
  id: "01930000-0000-7000-8000-000000000001",
  formId: "home-form",
  name: "Mona Ali",
  phone: "٠١٠١٢٣٤٥٦٧٨",
  phoneE164: "+201012345678",
  email: "mona@example.com",
  message: "Call me",
  status: "new",
  trackingStatus: "pending",
  eventId: "lead_01930000-0000-7000-8000-000000000001",
  createdAt: "2026-11-22T10:00:00.000Z",
  pageUrl: "https://shop.example/",
  referrer: null,
};

async function renderPage(result: unknown, locale: string | undefined = "en") {
  mocks.locale = locale;
  mocks.readSession.mockResolvedValue({ roles: ["operator"], token: "t" });
  mocks.fetchLead.mockResolvedValue(result);
  const ui = await LeadDetailPage({ params: Promise.resolve({ leadId: LEAD.id }) });
  return render(ui);
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  mocks.readSession.mockReset();
  mocks.fetchLead.mockReset();
});

describe("/leads/[leadId]", () => {
  it("shows the international phone, sending status and event id in an Ad platforms card", async () => {
    await renderPage({ outcome: "ok", lead: LEAD });
    const heading = screen.getByRole("heading", { level: 2, name: "Ad platforms" });
    const section = heading.parentElement?.parentElement as HTMLElement;
    expect(within(section).getByText("Phone (international)")).toBeDefined();
    expect(within(section).getByText("Sending status")).toBeDefined();
    expect(within(section).getByText("Waiting to send")).toBeDefined();
    expect(within(section).getByText("Event ID")).toBeDefined();
    const phone = within(section).getByText("+201012345678");
    expect(phone.tagName).toBe("BDI");
    expect(phone).toHaveAttribute("dir", "ltr");
    const eventId = within(section).getByText(LEAD.eventId);
    expect(eventId.tagName).toBe("BDI");
    expect(eventId).toHaveAttribute("dir", "ltr");
  });

  it("writes every tracking status out in English and Arabic", async () => {
    const cases = [
      ["pending", "Waiting to send", "مستني الإرسال"],
      ["suppressed", "Not sent (same session)", "متبعتش (نفس الجلسة)"],
      ["skipped_spam", "Not sent (spam)", "متبعتش (سبام)"],
      ["sent", "Sent", "اتبعت"],
      ["failed", "Failed to send", "فشل الإرسال"],
    ] as const;
    for (const [status, enText, arText] of cases) {
      cleanup();
      await renderPage({ outcome: "ok", lead: { ...LEAD, trackingStatus: status } }, "en");
      expect(screen.getByText(enText)).toBeDefined();
      expect(en.leadTrackingStatus[status]).toBe(enText);
      expect(ar.leadTrackingStatus[status]).toBe(arText);
      cleanup();
      await renderPage({ outcome: "ok", lead: { ...LEAD, trackingStatus: status } }, "ar");
      expect(screen.getByText(arText)).toBeDefined();
    }
  });

  it("uses the Arabic labels for the new card", async () => {
    await renderPage({ outcome: "ok", lead: LEAD }, "ar");
    expect(screen.getByRole("heading", { level: 2, name: "المنصات الإعلانية" })).toBeDefined();
    expect(screen.getByText("الرقم بالصيغة الدولية")).toBeDefined();
    expect(screen.getByText("حالة الإرسال")).toBeDefined();
    expect(screen.getByText("رقم الحدث (Event ID)")).toBeDefined();
  });

  it("falls back to the raw value for an unknown tracking status", async () => {
    await renderPage({ outcome: "ok", lead: { ...LEAD, trackingStatus: "mystery" } });
    expect(screen.getByText("mystery")).toBeDefined();
  });

  it("has exactly one h1 (the lead name) and h2 cards on the ok branch", async () => {
    await renderPage({ outcome: "ok", lead: LEAD });
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Mona Ali");
    const h2s = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2s).toEqual(["Ad platforms", en.leadDetail.statusTitle]);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it.each([
    ["not_found", { outcome: "not_found" }, en.leadDetail.notFound],
    ["unauthorized", { outcome: "unauthorized" }, en.leadDetail.unauthorized],
    ["error", { outcome: "error", message: "boom" }, en.leadDetail.error],
  ])("has one localized h1 on the %s branch", async (_name, result, message) => {
    await renderPage(result);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(en.leadDetail.heading);
    expect(screen.getByText(message)).toBeDefined();
  });

  it("localizes the h1 on a failure branch in Arabic", async () => {
    await renderPage({ outcome: "not_found" }, "ar");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(ar.leadDetail.heading);
  });
});
