import type { GetReview, GetReviewInput } from "../application/get-review.use-case";
import type {
  ListReviewsByProduct,
  ListReviewsByProductInput,
} from "../application/list-reviews-by-product.use-case";
import type { ListReviews, ListReviewsInput } from "../application/list-reviews.use-case";
import type {
  AdvanceReview,
  AdvanceReviewInput,
  CreateReview,
  CreateReviewInput,
  ModerateReview,
  ModerateReviewInput,
  ReportReview,
  ReportReviewInput,
  RespondToReview,
  RespondToReviewInput,
  VoteReview,
  VoteReviewInput,
} from "../application/review.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface ReviewsControllerDeps {
  readonly createReview: CreateReview;
  readonly advanceReview: AdvanceReview;
  readonly voteReview: VoteReview;
  readonly reportReview: ReportReview;
  readonly respondToReview: RespondToReview;
  readonly moderateReview: ModerateReview;
  readonly listReviews: ListReviews;
  readonly getReview: GetReview;
  readonly listReviewsByProduct: ListReviewsByProduct;
}

/** Framework-agnostic interface boundary for reviews use-cases (no HTTP server). */
export class ReviewsController {
  private readonly deps: ReviewsControllerDeps;

  constructor(deps: ReviewsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateReviewInput): Promise<ControllerResponse> {
    return present(await this.deps.createReview.execute(input), 201);
  }

  async advance(input: AdvanceReviewInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceReview.execute(input), 200);
  }

  async vote(input: VoteReviewInput): Promise<ControllerResponse> {
    return present(await this.deps.voteReview.execute(input), 200);
  }

  async report(input: ReportReviewInput): Promise<ControllerResponse> {
    return present(await this.deps.reportReview.execute(input), 200);
  }

  async respond(input: RespondToReviewInput): Promise<ControllerResponse> {
    return present(await this.deps.respondToReview.execute(input), 200);
  }

  async moderate(input: ModerateReviewInput): Promise<ControllerResponse> {
    return present(await this.deps.moderateReview.execute(input), 200);
  }

  async list(input: ListReviewsInput): Promise<ControllerResponse> {
    return present(await this.deps.listReviews.execute(input), 200);
  }

  async get(input: GetReviewInput): Promise<ControllerResponse> {
    return present(await this.deps.getReview.execute(input), 200);
  }

  async listByProduct(input: ListReviewsByProductInput): Promise<ControllerResponse> {
    return present(await this.deps.listReviewsByProduct.execute(input), 200);
  }
}
