export * from "./domain/customer-segment";
export type { CustomerSegmentRepository } from "./domain/customer-segment-repository";
export * from "./application/customer-segment.use-cases";
export * from "./interfaces/customer-segment.controller";
export { InMemoryCustomerSegmentRepository } from "./infrastructure/in-memory-customer-segment-repository";
export { PrismaCustomerSegmentRepository } from "./infrastructure/prisma-customer-segment-repository";
export { wireIdentity } from "./composition";
export type { IdentityWiringDeps, WiredIdentity } from "./composition";
export { CustomerController } from "./interfaces/customer.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Customer } from "./domain/customer";
export type {
  CustomerContact,
  CustomerContactReader,
  CustomerRepository,
} from "./domain/customer-repository";
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

export { Phone } from "./domain/value-objects/phone";
export {
  isCustomerLanguage,
  type CustomerLanguage,
} from "./domain/value-objects/customer-language";
export {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CUSTOMER,
  MAX_NOTE_LENGTH,
  normalizeTag,
  tagKeyOf,
  parseTags,
  normalizeNote,
  sortTags,
  compareText,
  characterCount,
  type CustomerTag,
  type CustomerAnnotations,
  type CustomerAnnotationRepository,
} from "./domain/customer-annotations";
export { InMemoryCustomerAnnotationRepository } from "./infrastructure/in-memory-customer-annotation-repository";
export { PrismaCustomerAnnotationRepository } from "./infrastructure/prisma-customer-annotation-repository";

// Wave 1b: customer profile, note, tags and marketing consent (staff-side).
export { CreateCustomer } from "./application/create-customer.use-case";
export type {
  CreateCustomerInput,
  CreateCustomerOutput,
} from "./application/create-customer.use-case";
export { UpdateCustomerProfile } from "./application/update-customer-profile.use-case";
export type {
  UpdateCustomerProfileInput,
  UpdateCustomerProfileOutput,
} from "./application/update-customer-profile.use-case";
export { SetCustomerNote } from "./application/set-customer-note.use-case";
export type {
  SetCustomerNoteInput,
  SetCustomerNoteOutput,
} from "./application/set-customer-note.use-case";
export { SetCustomerTags } from "./application/set-customer-tags.use-case";
export type {
  SetCustomerTagsInput,
  SetCustomerTagsOutput,
} from "./application/set-customer-tags.use-case";
export { ChangeMarketingConsent } from "./application/change-marketing-consent.use-case";
export type {
  ChangeMarketingConsentInput,
  ChangeMarketingConsentOutput,
} from "./application/change-marketing-consent.use-case";
export { GetCustomerAnnotations } from "./application/get-customer-annotations.use-case";
export type {
  CustomerAnnotationsItem,
  GetCustomerAnnotationsInput,
  GetCustomerAnnotationsOutput,
} from "./application/get-customer-annotations.use-case";
