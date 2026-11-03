import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { en } from "@/messages/en";

const upload = vi.hoisted(() => ({ uploadOnlineStoreImageAction: vi.fn() }));
const save = vi.hoisted(() => ({ savePreferencesAction: vi.fn(), saveAccessAction: vi.fn() }));
vi.mock("@/app/online-store/preferences/actions", () => save);
vi.mock("@/app/online-store/actions", () => upload);
const { PasswordProtectionCard } = await import("./password-protection-card");
const { PreferencesForm } = await import("./preferences-form");

const access = {
  locked: true,
  passwordSet: true,
  passwordUpdatedAt: "2026-10-20T09:00:00.000Z",
  message: { ar: "قريبًا" },
  version: 2,
};
const prefs = {
  homeTitle: { ar: "متجر" },
  homeMetaDescription: {},
  shareImage: null,
  shareImageId: null,
  defaultLocale: "ar" as const,
  storeName: "Nour",
  version: 1,
};
const shareImage = { url: "https://media.test/s.jpg", alt: null, width: 1200, height: 630 };
const p = en.onlineStorePreferences;

function renderForm(overrides: Partial<ComponentProps<typeof PreferencesForm>> = {}) {
  return render(
    <PreferencesForm
      t={en}
      locale="en"
      preferences={prefs}
      canEdit
      canChangeStoreName
      storefrontUrl={null}
      {...overrides}
    />,
  );
}

function hiddenShareImageId(container: HTMLElement): string | null {
  return container.querySelector<HTMLInputElement>('input[name="shareImageId"]')?.value ?? null;
}

function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  upload.uploadOnlineStoreImageAction.mockReset();
  save.savePreferencesAction.mockReset();
});

describe("Preferences screens", () => {
  it("an operator sees the password card read-only, with the admin-only hint", () => {
    render(<PasswordProtectionCard t={en} locale="en" access={access} isAdmin={false} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.queryByLabelText(en.onlineStorePreferences.newPassword)).toBeNull();
    expect(screen.getByText(en.onlineStorePreferences.adminOnly)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: p.save })).toBeNull();
  });

  it("an admin gets the switch and an empty, never pre-filled password field", () => {
    render(<PasswordProtectionCard t={en} locale="en" access={access} isAdmin />);
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByLabelText(en.onlineStorePreferences.newPassword)).toHaveValue("");
  });

  it("says whether a password is set from the flag alone, never echoing one", () => {
    const { rerender } = render(
      <PasswordProtectionCard
        t={en}
        locale="en"
        access={{ ...access, passwordUpdatedAt: null }}
        isAdmin
      />,
    );
    expect(screen.getByText(p.passwordSet)).toBeInTheDocument();
    rerender(
      <PasswordProtectionCard
        t={en}
        locale="en"
        access={{ ...access, locked: false, passwordSet: false, passwordUpdatedAt: null }}
        isAdmin
      />,
    );
    expect(screen.getByText(p.passwordNotSet)).toBeInTheDocument();
  });

  it("shows the store name read-only with a link to Settings → General, and counters", () => {
    renderForm({ storefrontUrl: "https://shop.example" });
    expect(screen.getByText("Nour")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: en.onlineStorePreferences.changeStoreName }),
    ).toHaveAttribute("href", "/settings/general");
    expect(screen.getByText("4/70")).toBeInTheDocument(); // "متجر" is 4 characters
    expect(screen.getByText("0/320")).toBeInTheDocument();
  });

  it("offers the Settings → General link only to admins (it is an admin-only screen)", () => {
    renderForm({ canChangeStoreName: false });
    expect(screen.getByText("Nour")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: p.changeStoreName })).toBeNull();
    expect(screen.getByText(p.storeNameAdminOnly)).toBeInTheDocument();
  });

  it("keeps the stored share image id in the form on load (F4)", () => {
    const { container } = renderForm({
      preferences: { ...prefs, shareImage, shareImageId: "img-share" },
    });
    expect(hiddenShareImageId(container)).toBe("img-share");
  });

  it("an archived share image is reported, kept until the merchant removes it, never cleared silently", () => {
    const { container } = renderForm({
      preferences: { ...prefs, shareImage: null, shareImageId: "img-gone" },
    });
    expect(screen.getByText(p.imageNotFound)).toBeInTheDocument();
    expect(hiddenShareImageId(container)).toBe("img-gone");
    fireEvent.click(screen.getByRole("button", { name: p.shareRemove }));
    expect(hiddenShareImageId(container)).toBe("");
    expect(screen.queryByText(p.imageNotFound)).toBeNull();
  });

  it("a save refused for that archived image points at Remove instead of repeating the sentence", async () => {
    save.savePreferencesAction.mockResolvedValue({
      status: "error",
      message: p.imageNotFound,
      fieldErrors: { shareImageId: p.imageNotFound },
    });
    renderForm({ preferences: { ...prefs, shareImage: null, shareImageId: "img-gone" } });
    fireEvent.click(screen.getByRole("button", { name: p.save }));
    const remove = screen.getByRole("button", { name: p.shareRemove });
    await waitFor(() => expect(remove).toHaveFocus());
    expect(screen.getAllByText(p.imageNotFound)).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(remove).toHaveAccessibleDescription(p.imageNotFound);
  });

  it("a viewer sees the preferences read-only, without a Save button", () => {
    renderForm({ canEdit: false, canChangeStoreName: false });
    expect(screen.queryByRole("button", { name: p.save })).toBeNull();
    expect(screen.getByRole("button", { name: p.upload })).toBeDisabled();
  });

  it("shows the uploaded file's name as plain text, never as markup", async () => {
    upload.uploadOnlineStoreImageAction.mockResolvedValue({
      status: "ok",
      image: {
        id: "img-new",
        url: "https://media.test/n.jpg",
        alt: null,
        width: 1200,
        height: 630,
      },
    });
    const name = '<img src=x onerror="alert(1)">.jpg';
    const { container } = renderForm();
    pickFile(container, new File(["x"], name, { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(hiddenShareImageId(container)).toBe("img-new");
  });

  it("an upload failure shows our own copy for its reason", async () => {
    upload.uploadOnlineStoreImageAction.mockResolvedValue({
      status: "error",
      reason: "too_many_pixels",
    });
    const { container } = renderForm();
    pickFile(container, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(p.uploadErrors.too_many_pixels),
    );
  });

  it("a wrong-size share image says which sizes fit", async () => {
    upload.uploadOnlineStoreImageAction.mockResolvedValue({
      status: "error",
      reason: "bad_dimensions",
    });
    const { container } = renderForm();
    pickFile(container, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(p.uploadDimensionHints.share_image),
    );
    expect(p.uploadDimensionHints.share_image).toContain("600 × 315");
  });

  it("removing the image also clears a stale upload error", async () => {
    upload.uploadOnlineStoreImageAction.mockResolvedValue({ status: "error", reason: "failed" });
    const { container } = renderForm({
      preferences: { ...prefs, shareImage, shareImageId: "img-share" },
    });
    pickFile(container, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: p.shareRemove }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
