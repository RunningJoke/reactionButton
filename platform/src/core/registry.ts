import { auditUseCases } from "../modules/audit/useCases";
import { programUseCases } from "../modules/catalog/programs";
import { catalogExtraUseCases } from "../modules/catalog/presetsSets";
import { identityUseCases } from "../modules/identity/useCases";
import { metaUseCases } from "../modules/meta/useCases";
import { orgUseCases } from "../modules/orgs/useCases";
import type { UseCase } from "./useCase";

/** Every use case of the platform. REST routes, OpenAPI and MCP tools are generated from this list. */
export const useCases: readonly UseCase[] = [
  ...metaUseCases,
  ...identityUseCases,
  ...orgUseCases,
  ...auditUseCases,
  ...programUseCases,
  ...catalogExtraUseCases,
];
