export { wireIdentity } from "./composition";
export type { IdentityWiringDeps, WiredIdentity } from "./composition";
export { CustomerController } from "./interfaces/customer.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Customer } from "./domain/customer";
export type { CustomerRepository } from "./domain/customer-repository";
export {
  PrismaCustomerRepository,
  type PrismaCustomerRepositoryDeps,
} from "./infrastructure/prisma-customer-repository";

// G-72: guest-to-account upgrade (verification-gated signup completion).
export { RequestSignupLink } from "./application/request-signup-link.use-case";
export type {
  RequestSignupLinkInput,
  RequestSignupLinkOutput,
} from "./application/request-signup-link.use-case";
export { CompleteSignup } from "./application/complete-signup.use-case";
export type {
  CompleteSignupInput,
  CompleteSignupOutput,
} from "./application/complete-signup.use-case";
export type { TokenPort } from "./application/token-port";
export { NodeTokenPort } from "./infrastructure/node-token-port";
export { SignupToken } from "./domain/signup-token";
export type { SignupTokenRepository } from "./domain/signup-token-repository";
export {
  PrismaSignupTokenRepository,
  type PrismaSignupTokenRepositoryDeps,
} from "./infrastructure/prisma-signup-token-repository";

export { AccessController } from "./interfaces/access.controller";
export { User } from "./domain/user";
export type { UserStatus } from "./domain/user";
export { Organization } from "./domain/organization";
export type { OrganizationStatus } from "./domain/organization";
export { Membership } from "./domain/membership";
export type {
  UserRepository,
  OrganizationRepository,
  MembershipRepository,
} from "./domain/access-repositories";
export { OrganizationSlug } from "./domain/value-objects/organization-slug";
export { RoleName } from "./domain/value-objects/role-name";
export {
  PrismaUserRepository,
  PrismaOrganizationRepository,
  PrismaMembershipRepository,
} from "./infrastructure/prisma-access-repositories";
export { IDENTITY_PUBLISHED_EVENTS } from "./infrastructure/identity-event-translator";
