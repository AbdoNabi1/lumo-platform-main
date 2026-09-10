import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Redirect } from "../domain/redirect";
import { RobotsPolicy } from "../domain/robots-policy";
import type {
  RedirectRepository,
  RobotsPolicyRepository,
  SeoProfileRepository,
  SitemapRepository,
} from "../domain/repositories";
import { SeoProfile } from "../domain/seo-profile";
import { Sitemap } from "../domain/sitemap";
import { SeoMetadata, type RedirectStatusCode, type RobotsRule } from "../domain/value-objects/seo";

export interface SeoDeps {
  readonly profiles: SeoProfileRepository;
  readonly redirects: RedirectRepository;
  readonly sitemaps: SitemapRepository;
  readonly robotsPolicies: RobotsPolicyRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface SetSeoProfileInput {
  readonly pageRef: string;
  readonly title?: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
  readonly ogImageRef?: string;
  readonly tenantId: string;
}

export interface SeoIdOutput {
  readonly id: string;
}

/** Creates or updates the SEO profile for a page — one per `pageRef`. */
export class SetSeoProfile implements UseCase<SetSeoProfileInput, SeoIdOutput, DomainError> {
  private readonly deps: SeoDeps;

  constructor(deps: SeoDeps) {
    this.deps = deps;
  }

  async execute(input: SetSeoProfileInput): Promise<Result<SeoIdOutput, DomainError>> {
    const pageRef = Guard.againstEmpty(input.pageRef, "pageRef");
    if (!pageRef.ok) return err(pageRef.error);

    return this.deps.unitOfWork.run<Result<SeoIdOutput, DomainError>>(async (tx) => {
      const metadata = SeoMetadata.create({
        title: input.title,
        description: input.description,
        canonicalUrl: input.canonicalUrl,
        ogImageRef: input.ogImageRef,
      });
      const existing = await this.deps.profiles.findByPageRef(input.pageRef, input.tenantId, tx);
      if (existing !== null) {
        existing.update(metadata, this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.profiles.save(existing, tx);
        return ok({ id: existing.id.toString() });
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const profile = SeoProfile.create(
        id,
        input.pageRef,
        metadata,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.profiles.save(profile, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface CreateRedirectInput {
  readonly fromPath: string;
  readonly toPath: string;
  readonly statusCode: RedirectStatusCode;
  readonly tenantId: string;
}

/** Creates a redirect rule — one per `fromPath`. */
export class CreateRedirect implements UseCase<CreateRedirectInput, SeoIdOutput, DomainError> {
  private readonly deps: SeoDeps;

  constructor(deps: SeoDeps) {
    this.deps = deps;
  }

  async execute(input: CreateRedirectInput): Promise<Result<SeoIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SeoIdOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.redirects.findByFromPath(input.fromPath, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Redirect from "${input.fromPath}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const redirect = Redirect.create(
        id,
        input.fromPath,
        input.toPath,
        input.statusCode,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.redirects.save(redirect, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface CreateSitemapInput {
  readonly name: string;
  readonly tenantId: string;
}

/** Creates a sitemap document — one per `name`. */
export class CreateSitemap implements UseCase<CreateSitemapInput, SeoIdOutput, DomainError> {
  private readonly deps: SeoDeps;

  constructor(deps: SeoDeps) {
    this.deps = deps;
  }

  async execute(input: CreateSitemapInput): Promise<Result<SeoIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SeoIdOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.sitemaps.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Sitemap "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const sitemap = Sitemap.create(
        id,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.sitemaps.save(sitemap, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface RegenerateSitemapInput {
  readonly sitemapId: string;
  readonly urls: readonly string[];
  readonly tenantId: string;
}

/** Regenerates a sitemap's URL list. */
export class RegenerateSitemap implements UseCase<
  RegenerateSitemapInput,
  SeoIdOutput,
  DomainError
> {
  private readonly deps: SeoDeps;

  constructor(deps: SeoDeps) {
    this.deps = deps;
  }

  async execute(input: RegenerateSitemapInput): Promise<Result<SeoIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SeoIdOutput, DomainError>>(async (tx) => {
      const sitemap = await this.deps.sitemaps.findById(input.sitemapId, input.tenantId, tx);
      if (sitemap === null) return err(new NotFoundError("Sitemap not found"));
      sitemap.regenerate(input.urls, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.sitemaps.save(sitemap, tx);
      return ok({ id: sitemap.id.toString() });
    });
  }
}

export interface SetRobotsPolicyInput {
  readonly userAgent: string;
  readonly rules: readonly RobotsRule[];
  readonly tenantId: string;
}

/** Creates or updates a robots policy for a user agent. */
export class SetRobotsPolicy implements UseCase<SetRobotsPolicyInput, SeoIdOutput, DomainError> {
  private readonly deps: SeoDeps;

  constructor(deps: SeoDeps) {
    this.deps = deps;
  }

  async execute(input: SetRobotsPolicyInput): Promise<Result<SeoIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SeoIdOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.robotsPolicies.findByUserAgent(
        input.userAgent,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        existing.setRules(input.rules, this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.robotsPolicies.save(existing, tx);
        return ok({ id: existing.id.toString() });
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const policy = RobotsPolicy.create(
        id,
        input.userAgent,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      policy.setRules(input.rules, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.robotsPolicies.save(policy, tx);
      return ok({ id: id.toString() });
    });
  }
}
