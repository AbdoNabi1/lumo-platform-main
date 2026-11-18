import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FormState } from "@/lib/api/mutation";
import { buildSetupSteps, type SetupFacts } from "@/lib/dashboard/setup-guide";
import { formatNumber } from "@/lib/format";
import { dictionaryFor } from "@/lib/i18n";
import { en, type Dictionary } from "@/messages/en";
import { SetupGuide } from "./setup-guide";

const ar: Dictionary = dictionaryFor("ar");

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const dismissSetupGuideAction = vi.fn<Action>();

vi.mock("@/app/setup-guide-actions", () => ({
  dismissSetupGuideAction: (previous: FormState, formData: FormData) =>
    dismissSetupGuideAction(previous, formData),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  dismissSetupGuideAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(cleanup);

const NOTHING: SetupFacts = {
  productCount: 0,
  shippingZoneCount: 0,
  enabledPaymentMethods: 0,
  hasVerifiedCustomDomain: false,
  orderCount: 0,
};

function guide(facts: SetupFacts = NOTHING, t: Dictionary = en) {
  return render(
    <SetupGuide steps={buildSetupSteps(facts)} t={t} locale={t === ar ? "ar" : "en"} />,
  );
}

describe("SetupGuide", () => {
  it("shows the title and 0 of 5 for a brand new store", () => {
    guide();

    expect(screen.getByRole("heading", { name: "Set up your store" })).toBeInTheDocument();
    expect(screen.getByText("0 of 5 tasks complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "5");
  });

  it("counts only tracked steps that are done", () => {
    guide({ ...NOTHING, productCount: 1, shippingZoneCount: 1 });

    expect(screen.getByText("2 of 5 tasks complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  });

  it("lists the six steps in Shopify's order", () => {
    guide();

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-step"))).toEqual([
      "product",
      "shipping",
      "payments",
      "theme",
      "domain",
      "order",
    ]);
  });

  it("opens the first open step and links it to its screen", () => {
    guide();

    expect(screen.getByRole("button", { name: /Add your first product/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Add product" })).toHaveAttribute(
      "href",
      "/products/new",
    );
    expect(screen.getByRole("button", { name: /Set up shipping/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens the next open step when the first is done", () => {
    guide({ ...NOTHING, productCount: 1 });

    expect(screen.getByRole("button", { name: /Set up shipping/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Set up shipping" })).toHaveAttribute(
      "href",
      "/settings/shipping",
    );
  });

  it("expands a row on click and collapses the one before", () => {
    guide();

    fireEvent.click(screen.getByRole("button", { name: /Connect a domain/ }));

    expect(screen.getByRole("button", { name: /Connect a domain/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /Add your first product/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("link", { name: "Connect domain" })).toHaveAttribute(
      "href",
      "/settings/domains",
    );
  });

  it("marks done steps with a check and never marks the theme step", () => {
    guide({ ...NOTHING, productCount: 1 });

    const product = screen.getByRole("button", { name: /Add your first product/ });
    expect(within(product).getByLabelText("Done")).toBeInTheDocument();
    const shipping = screen.getByRole("button", { name: /Set up shipping/ });
    expect(within(shipping).getByLabelText("Not done")).toBeInTheDocument();
    const theme = screen.getByRole("button", { name: /Customize your store/ });
    expect(within(theme).queryByLabelText("Done")).toBeNull();
    expect(within(theme).queryByLabelText("Not done")).toBeNull();
  });

  it("dismisses through the server action", async () => {
    guide();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(dismissSetupGuideAction).toHaveBeenCalledTimes(1));
  });

  it("keeps the guide but offers no Dismiss when the user may not change settings", () => {
    render(<SetupGuide steps={buildSetupSteps(NOTHING)} t={en} canDismiss={false} />);

    expect(screen.getByText("0 of 5 tasks complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("shows why the dismiss failed", async () => {
    dismissSetupGuideAction.mockResolvedValue({
      status: "error",
      message: "Something went wrong.",
      fieldErrors: {},
    });
    guide();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("renders in Arabic", () => {
    guide({ ...NOTHING, productCount: 1 }, ar);

    expect(screen.getByRole("heading", { name: "جهّز متجرك" })).toBeInTheDocument();
    expect(
      screen.getByText(`خلصت ${formatNumber("ar", 1)} من ${formatNumber("ar", 5)} مهام`),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ضيف أول منتج/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إخفاء" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تجهيز الشحن" })).toHaveAttribute(
      "href",
      "/settings/shipping",
    );
  });
});
