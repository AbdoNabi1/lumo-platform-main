export type BostaTarget =
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | "returned"
  | "cancelled"
  | "exception";

const LABELS: Readonly<Record<number, string>> = {
  10: "Pickup requested",
  11: "Waiting for route",
  20: "Route assigned",
  21: "Picked up from business",
  22: "Picking up from consignee",
  23: "Picked up from consignee",
  24: "Received at warehouse",
  25: "Fulfilled",
  30: "In transit between hubs",
  40: "Picking up",
  45: "Delivered",
  46: "Returned to business",
  47: "Exception",
  48: "Terminated",
  49: "Canceled",
  60: "Returned to stock",
  100: "Lost",
  101: "Damaged",
  102: "Investigation",
  103: "Awaiting your action",
  104: "Archived",
  105: "On hold",
};

export function mapBostaState(
  state: number,
  type: string | undefined,
): { readonly target: BostaTarget | null; readonly label: string } {
  const forward = type === undefined || type === "SEND" || type === "FXF_SEND";
  let target: BostaTarget | null = null;
  if ((state === 21 || state === 24 || state === 30) && forward) target = "in_transit";
  else if (state === 41 && type === "SEND") target = "out_for_delivery";
  else if (state === 45) target = "delivered";
  else if (state === 47 && forward) target = "delivery_failed";
  else if (state === 46 || state === 60) target = "returned";
  else if (state === 48 || state === 49) target = "cancelled";
  else if (state === 100 || state === 101) target = "exception";
  const label =
    state === 41
      ? type === "SEND"
        ? "Out for delivery"
        : "Out for return"
      : (LABELS[state] ?? `Bosta state ${state}`);
  return { target, label };
}

export function bostaScanText(
  state: number,
  type: string | undefined,
  exceptionReason: string | undefined,
): string {
  const label = mapBostaState(state, type).label;
  return state === 47 && exceptionReason ? `${label}: ${exceptionReason}`.slice(0, 200) : label;
}
