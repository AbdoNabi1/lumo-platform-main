import type {
  ChangeLeadStatus,
  ChangeLeadStatusInput,
  GetLead,
  GetLeadInput,
  ListLeadExportRows,
  ListLeadExportRowsInput,
  ListLeads,
  ListLeadsInput,
  SubmitLead,
  SubmitLeadInput,
} from "../application/leads.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface LeadsControllerDeps {
  readonly submitLead: SubmitLead;
  readonly listLeads: ListLeads;
  readonly getLead: GetLead;
  readonly changeLeadStatus: ChangeLeadStatus;
  readonly listLeadExportRows: ListLeadExportRows;
}

/** Framework-agnostic interface boundary for lead use-cases (no HTTP server). */
export class LeadsController {
  private readonly deps: LeadsControllerDeps;

  constructor(deps: LeadsControllerDeps) {
    this.deps = deps;
  }

  async submit(input: SubmitLeadInput): Promise<ControllerResponse> {
    return present(await this.deps.submitLead.execute(input), 201);
  }

  async list(input: ListLeadsInput): Promise<ControllerResponse> {
    return present(await this.deps.listLeads.execute(input), 200);
  }

  async get(input: GetLeadInput): Promise<ControllerResponse> {
    return present(await this.deps.getLead.execute(input), 200);
  }

  async changeStatus(input: ChangeLeadStatusInput): Promise<ControllerResponse> {
    return present(await this.deps.changeLeadStatus.execute(input), 200);
  }

  async exportRows(input: ListLeadExportRowsInput): Promise<ControllerResponse> {
    return present(await this.deps.listLeadExportRows.execute(input), 200);
  }
}
