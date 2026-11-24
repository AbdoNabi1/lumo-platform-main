import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { TemplatePreview, type TemplatePreviewValues } from "./template-preview";

const values: TemplatePreviewValues = {
  header: "Order {{1}}",
  headerExample: "1001",
  body: "Hi {{1}}, your order {{2}} has shipped.",
  examples: ["Sara", "1001"],
  footer: "Reply STOP to opt out",
  buttons: ["Track", "Thanks"],
};

describe("TemplatePreview", () => {
  it("substitutes the examples into the header and the body and renders footer and buttons", () => {
    expect.hasAssertions();
    render(<TemplatePreview values={values} t={en} />);
    const bubble = screen.getByRole("group", { name: en.whatsappTemplates.preview.bubbleLabel });
    expect(within(bubble).getByTestId("preview-header")).toHaveTextContent("Order 1001");
    expect(within(bubble).getByTestId("preview-body")).toHaveTextContent(
      "Hi Sara, your order 1001 has shipped.",
    );
    expect(within(bubble).getByTestId("preview-footer")).toHaveTextContent("Reply STOP to opt out");
    expect(
      within(bubble)
        .getAllByTestId("preview-button")
        .map((b) => b.textContent),
    ).toEqual(["Track", "Thanks"]);
    expect(bubble).not.toHaveTextContent("{{");
  });

  it("renders an Arabic body in an element with dir=auto (RTL) while the shell stays as it is", () => {
    expect.hasAssertions();
    render(
      <TemplatePreview
        values={{
          header: "",
          headerExample: "",
          body: "أهلاً {{1}}، طلبك {{2}} اتشحن النهارده.",
          examples: ["سارة", "1001"],
          footer: "ابعت STOP لإلغاء الاشتراك",
          buttons: ["تتبّع الطلب"],
        }}
        t={ar}
      />,
    );
    const body = screen.getByTestId("preview-body");
    expect(body).toHaveAttribute("dir", "auto");
    expect(body).toHaveTextContent("أهلاً سارة، طلبك 1001 اتشحن النهارده.");
    expect(screen.getByTestId("preview-footer")).toHaveAttribute("dir", "auto");
    expect(screen.getByTestId("preview-button")).toHaveAttribute("dir", "auto");
    expect(screen.queryByTestId("preview-header")).toBeNull();
  });

  it("every text block carries dir=auto", () => {
    expect.hasAssertions();
    render(<TemplatePreview values={values} t={en} />);
    for (const id of ["preview-header", "preview-body", "preview-footer"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("dir", "auto");
    }
    for (const button of screen.getAllByTestId("preview-button")) {
      expect(button).toHaveAttribute("dir", "auto");
    }
  });

  it("leaves a variable visible until its example is filled", () => {
    expect.hasAssertions();
    render(<TemplatePreview values={{ ...values, examples: ["Sara", "  "] }} t={en} />);
    expect(screen.getByTestId("preview-body")).toHaveTextContent(
      "Hi Sara, your order {{2}} has shipped.",
    );
  });

  it("shows a hint instead of an empty bubble", () => {
    expect.hasAssertions();
    render(
      <TemplatePreview
        values={{
          header: "",
          headerExample: "",
          body: "  ",
          examples: [],
          footer: "",
          buttons: [],
        }}
        t={en}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappTemplates.preview.empty);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("an empty button label shows an ellipsis, not a blank button", () => {
    expect.hasAssertions();
    render(<TemplatePreview values={{ ...values, buttons: [""] }} t={en} />);
    expect(screen.getByTestId("preview-button")).toHaveTextContent("…");
  });
});
