import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { EmailSettingsDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import { emailDisplayName, normalizeEmail } from "./support";

/** What a merchant's email will look like: the From display name, and the Reply-To (the store contact email). */
export class GetEmailSettings implements UseCase<
  { tenantId: string },
  EmailSettingsDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: { tenantId: string }): Promise<Result<EmailSettingsDto, DomainError>> {
    const { deps } = this;
    if (deps.email === undefined || deps.emailFrom === undefined) {
      return ok({ available: false, from: null, replyTo: null });
    }
    const profile = await deps.storeProfile.get(input.tenantId);
    return ok({
      available: true,
      from: `${emailDisplayName(profile.storeName)} <${deps.emailFrom}>`,
      replyTo: normalizeEmail(profile.contactEmail),
    });
  }
}
