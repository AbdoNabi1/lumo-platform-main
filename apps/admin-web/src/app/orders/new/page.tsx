import { redirect } from "next/navigation";

/** Spec §4.1 decision: "Create order" is a draft order now (Shopify's behaviour). */
export default function NewOrderPage(): never {
  redirect("/draft-orders/new");
}
