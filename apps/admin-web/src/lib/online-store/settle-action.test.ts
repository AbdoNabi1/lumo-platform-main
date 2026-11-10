import { describe, expect, it } from "vitest";
import { notFound, redirect } from "next/navigation";
import { settleAction } from "./settle-action";

describe("settleAction (a thrown server action never leaves a form stuck)", () => {
  it("answers the action's own result", async () => {
    expect(await settleAction(() => Promise.resolve("ok"), "fallback")).toBe("ok");
  });
  it("a crashed or unreachable action becomes the fallback (our own copy)", async () => {
    expect(await settleAction(() => Promise.reject(new Error("offline")), "fallback")).toBe(
      "fallback",
    );
  });
  it("still lets Next's redirect and notFound through, so navigation happens", async () => {
    const redirecting = () =>
      new Promise<string>(() => {
        redirect("/pages/p-1");
      });
    await expect(settleAction(redirecting, "fallback")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    const missing = () =>
      new Promise<string>(() => {
        notFound();
      });
    await expect(settleAction(missing, "fallback")).rejects.toBeInstanceOf(Error);
  });
});
