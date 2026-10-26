import type { Principal } from "@platform/contracts";
import type { DraftOrderDto } from "../draft-order-dto";
import {
  recoveryWorld,
  seedRecoveryProduct,
  unwrap,
  type RecoveryWorld,
} from "./abandoned-harness";
import { adminStaff, HARNESS_TENANT, operatorStaff } from "./orders-harness";
import type { SeededProduct } from "./seed-catalog";

/** TEST-ONLY (order operations Part 4): the real in-memory composition plus two EGP products. */
export interface DraftWorld extends RecoveryWorld {
  readonly tee: SeededProduct;
  readonly cap: SeededProduct;
}

export async function draftWorld(): Promise<DraftWorld> {
  const world = recoveryWorld();
  const tee = await seedRecoveryProduct(world, "TEE", 25000);
  const cap = await seedRecoveryProduct(world, "CAP", 9000);
  return Object.assign(world, { tee, cap });
}

export const DRAFT_ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
} as const;

/** A complete draft body: two lines, a 10 % discount, custom shipping, a guest email. */
export function draftBody(world: DraftWorld, over: Record<string, unknown> = {}) {
  return {
    email: "sara@example.com",
    phone: "01001234567",
    shippingAddress: DRAFT_ADDRESS,
    lines: [
      { productId: world.tee.productId, variantId: world.tee.variantId, quantity: 2 },
      { productId: world.cap.productId, variantId: world.cap.variantId, quantity: 1 },
    ],
    discount: { valueType: "percentage", value: 10, reason: "Loyal customer" },
    shipping: { kind: "custom", title: "Courier", amountMinor: 4000 },
    note: "Deliver after 5 pm",
    tags: ["WhatsApp"],
    ...over,
  };
}

export async function createDraft(
  world: DraftWorld,
  over: Record<string, unknown> = {},
  principal: Principal = operatorStaff,
): Promise<DraftOrderDto> {
  return unwrap<DraftOrderDto>(
    await world.staffCall("POST", "/draft-orders", { body: draftBody(world, over) }, principal),
    "create draft",
  );
}

/** Settings → Payments: cash on delivery on (Ruling 7). */
export async function enableCashOnDelivery(world: DraftWorld): Promise<void> {
  const response = await world.admin.payments.updateSettings(adminStaff, {
    tenantId: HARNESS_TENANT,
    enabledMethods: ["cod", "stripe"],
  });
  if (response.status !== 200) throw new Error(`enable COD answered ${response.status}`);
}
