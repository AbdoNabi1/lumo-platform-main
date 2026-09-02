export { wirePages } from "./composition";
export type { PagesWiringDeps, WiredPages } from "./composition";
export { PagesController } from "./interfaces/pages.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Page } from "./domain/page";
export { Template } from "./domain/template";
export type { PageRepository, TemplateRepository } from "./domain/repositories";
export {
  PrismaPageRepository,
  PrismaTemplateRepository,
  type PrismaPagesRepositoriesDeps,
} from "./infrastructure/prisma-repositories";
export { PAGES_PUBLISHED_EVENTS } from "./infrastructure/pages-event-translator";
