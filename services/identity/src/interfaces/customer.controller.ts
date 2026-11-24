import type { AddAddress, AddAddressInput } from "../application/add-address.use-case";
import type { ChangeConsent, ChangeConsentInput } from "../application/change-consent.use-case";
import type { CompleteSignup, CompleteSignupInput } from "../application/complete-signup.use-case";
import type {
  GetCustomerContacts,
  GetCustomerContactsInput,
} from "../application/get-customer-contacts.use-case";
import type {
  ChangeMarketingConsent,
  ChangeMarketingConsentInput,
} from "../application/change-marketing-consent.use-case";
import type { CreateCustomer, CreateCustomerInput } from "../application/create-customer.use-case";
import type {
  GetCustomerAnnotations,
  GetCustomerAnnotationsInput,
} from "../application/get-customer-annotations.use-case";
import type { GetCustomer, GetCustomerInput } from "../application/get-customer.use-case";
import type { ListCustomers, ListCustomersInput } from "../application/list-customers.use-case";
import type {
  RegisterCustomer,
  RegisterCustomerInput,
} from "../application/register-customer.use-case";
import type {
  RequestSignupLink,
  RequestSignupLinkInput,
} from "../application/request-signup-link.use-case";
import type {
  ResolveGuestCustomer,
  ResolveGuestCustomerInput,
} from "../application/resolve-guest-customer.use-case";
import type {
  SetCustomerNote,
  SetCustomerNoteInput,
} from "../application/set-customer-note.use-case";
import type {
  SetCustomerTags,
  SetCustomerTagsInput,
} from "../application/set-customer-tags.use-case";
import type {
  UpdateCustomerProfile,
  UpdateCustomerProfileInput,
} from "../application/update-customer-profile.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface CustomerControllerDeps {
  readonly registerCustomer: RegisterCustomer;
  readonly resolveGuestCustomer: ResolveGuestCustomer;
  readonly requestSignupLink: RequestSignupLink;
  readonly completeSignup: CompleteSignup;
  readonly addAddress: AddAddress;
  readonly changeConsent: ChangeConsent;
  readonly getCustomer: GetCustomer;
  readonly listCustomers: ListCustomers;
  readonly getCustomerContacts: GetCustomerContacts;
  readonly createCustomer: CreateCustomer;
  readonly updateCustomerProfile: UpdateCustomerProfile;
  readonly setCustomerNote: SetCustomerNote;
  readonly setCustomerTags: SetCustomerTags;
  readonly changeMarketingConsent: ChangeMarketingConsent;
  readonly getCustomerAnnotations: GetCustomerAnnotations;
}

/** Framework-agnostic interface boundary for customer use-cases (no HTTP server). */
export class CustomerController {
  private readonly deps: CustomerControllerDeps;

  constructor(deps: CustomerControllerDeps) {
    this.deps = deps;
  }

  async register(input: RegisterCustomerInput): Promise<ControllerResponse> {
    return present(await this.deps.registerCustomer.execute(input), 201);
  }

  /** Find-or-create for guest checkout (WP-1). Never authenticates — see `ResolveGuestCustomer`. */
  async resolveGuestCustomer(input: ResolveGuestCustomerInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveGuestCustomer.execute(input), 200);
  }

  /** G-72: "new" / "already-registered" / "guest" — see `RequestSignupLink`'s own doc comment for the D2 constraint this feeds. */
  async requestSignupLink(input: RequestSignupLinkInput): Promise<ControllerResponse> {
    return present(await this.deps.requestSignupLink.execute(input), 200);
  }

  /** G-72: validates + consumes a signup token and upgrades the guest row — see `CompleteSignup`. */
  async completeSignup(input: CompleteSignupInput): Promise<ControllerResponse> {
    return present(await this.deps.completeSignup.execute(input), 200);
  }

  async addAddress(input: AddAddressInput): Promise<ControllerResponse> {
    return present(await this.deps.addAddress.execute(input), 201);
  }

  async changeConsent(input: ChangeConsentInput): Promise<ControllerResponse> {
    return present(await this.deps.changeConsent.execute(input), 200);
  }

  async getCustomer(input: GetCustomerInput): Promise<ControllerResponse> {
    return present(await this.deps.getCustomer.execute(input), 200);
  }

  async listCustomers(input: ListCustomersInput): Promise<ControllerResponse> {
    return present(await this.deps.listCustomers.execute(input), 200);
  }

  /** The names and emails of a set of customers in one read (Plan 3D: labelling a page of orders). */
  async customerContacts(input: GetCustomerContactsInput): Promise<ControllerResponse> {
    return present(await this.deps.getCustomerContacts.execute(input), 200);
  }

  /** Staff-created customer with profile, marketing assertions, note and tags (Wave 1b). */
  async createCustomer(input: CreateCustomerInput): Promise<ControllerResponse> {
    return present(await this.deps.createCustomer.execute(input), 201);
  }

  async updateCustomerProfile(input: UpdateCustomerProfileInput): Promise<ControllerResponse> {
    return present(await this.deps.updateCustomerProfile.execute(input), 200);
  }

  async setCustomerNote(input: SetCustomerNoteInput): Promise<ControllerResponse> {
    return present(await this.deps.setCustomerNote.execute(input), 200);
  }

  async setCustomerTags(input: SetCustomerTagsInput): Promise<ControllerResponse> {
    return present(await this.deps.setCustomerTags.execute(input), 200);
  }

  async changeMarketingConsent(input: ChangeMarketingConsentInput): Promise<ControllerResponse> {
    return present(await this.deps.changeMarketingConsent.execute(input), 200);
  }

  /** The notes and tags of a set of customers in one read, in input order. */
  async customerAnnotations(input: GetCustomerAnnotationsInput): Promise<ControllerResponse> {
    return present(await this.deps.getCustomerAnnotations.execute(input), 200);
  }
}
