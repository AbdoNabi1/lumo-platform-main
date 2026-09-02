export { wireAutomation } from "./composition";
export type { AutomationWiringDeps, WiredAutomation } from "./composition";
export { AutomationController } from "./interfaces/automation.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { AutomationWorkflow } from "./domain/automation-workflow";
export type { AutomationWorkflowRepository } from "./domain/automation-workflow-repository";
export type { ActionDispatcherPort } from "./application/ports";
export {
  PrismaAutomationWorkflowRepository,
  type PrismaAutomationWorkflowRepositoryDeps,
} from "./infrastructure/prisma-automation-workflow-repository";
export { AUTOMATION_PUBLISHED_EVENTS } from "./infrastructure/automation-event-translator";
