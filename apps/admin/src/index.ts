export { wireAdmin } from "./composition";
export type { AdminWiringDeps, WiredAdmin } from "./composition";
export type { AdminResponse } from "./interfaces/admin-response";
export { ProductsAdminController } from "./interfaces/products.admin-controller";
export { InventoryAdminController } from "./interfaces/inventory.admin-controller";
export { OrdersAdminController } from "./interfaces/orders.admin-controller";
export { CustomersAdminController } from "./interfaces/customers.admin-controller";
export { PricingAdminController } from "./interfaces/pricing.admin-controller";
export { createAdminHttpApi, type AdminHttpDeps } from "./http/server";
export type { SignupEmailPort } from "./interfaces/signup-email.port";
export { LoggingSignupEmailAdapter } from "./infrastructure/logging-signup-email-adapter";
// Plan 1C: the platform's one email sender, with a Resend adapter and a logging fallback.
export type { EmailSender } from "./interfaces/email-sender.port";
export { ResendEmailSender } from "./infrastructure/resend-email-sender";
export { LoggingEmailSender } from "./infrastructure/logging-email-sender";
export { EmailSignupEmailAdapter } from "./infrastructure/email-signup-email-adapter";
