import { describe, expect, it, vi } from "vitest";
import { toErrorEnvelope, UnexpectedError } from "@platform/utils";
import { unwrap } from "./testing/abandoned-harness";
import { createDraft, draftWorld, type DraftWorld } from "./testing/draft-harness";
import { operatorStaff, viewerStaff } from "./testing/orders-harness";

/**
 * Wave 2b: "Send invoice" also mails the customer. The mail is the LAST thing the route does, best
 * effort: the merchant's answer (the link) never depends on it.
 */
interface InvoiceLink {
  url: string | null;
  path: string;
  expiresAt: string;
}

const send = (world: DraftWorld, draftId: string, principal = operatorStaff) =>
  world.staffCall(
    "POST",
    "/draft-orders/:draftId/invoice-link",
    { params: { draftId } },
    principal,
  );

describe("POST /draft-orders/:draftId/invoice-link also mails the invoice (Wave 2b)", () => {
  it("hands the notifier the draft, the issued link's id and the link, once per Send invoice", async () => {
    expect.hasAssertions();
    const world = await draftWorld();
    const spy = vi.spyOn(world.admin.draftInvoiceNotifications, "sendInvoice").mockResolvedValue();
    const draft = await createDraft(world);
    const link = unwrap<InvoiceLink>(await send(world, draft.id), "send");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]![0];
    expect(call.draft.id).toBe(draft.id);
    expect(call.draft.email).toBe("sara@example.com");
    expect(call.draft.lines.length).toBe(2);
    expect(call.linkId).toMatch(/\S/);
    expect(call.path).toBe(link.path);
    expect(call.url).toBe(link.url);
    unwrap<InvoiceLink>(await send(world, draft.id), "send again");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0].linkId).not.toBe(call.linkId);
  });

  it("a mail that blows up never changes the answer: the merchant still gets the link", async () => {
    expect.hasAssertions();
    const world = await draftWorld();
    vi.spyOn(world.admin.draftInvoiceNotifications, "sendInvoice").mockRejectedValue(
      new Error("mail is down"),
    );
    const draft = await createDraft(world);
    const reply = await send(world, draft.id);
    expect(reply.status).toBe(201);
    expect((reply.body as InvoiceLink).path).toMatch(/^\/c\//);
  });

  it("nothing is mailed when the invoice is refused: not ready, a viewer, or a link that could not be issued", async () => {
    expect.hasAssertions();
    const world = await draftWorld();
    const spy = vi.spyOn(world.admin.draftInvoiceNotifications, "sendInvoice").mockResolvedValue();
    const bare = await createDraft(world, { shipping: null });
    expect((await send(world, bare.id)).status).toBe(422);
    expect((await send(world, bare.id, viewerStaff)).status).toBe(403);
    const ready = await createDraft(world);
    const outage = { status: 503, body: toErrorEnvelope(new UnexpectedError("unavailable")) };
    vi.spyOn(world.admin.publicReads.checkout, "issueInvoiceLink").mockResolvedValueOnce(outage);
    expect((await send(world, ready.id)).status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
  });
});
