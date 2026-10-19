import { metaUseCases } from "../modules/meta/useCases";
import type { UseCase } from "./useCase";

/** Every use case of the platform. REST routes, OpenAPI and MCP tools are generated from this list. */
export const useCases: readonly UseCase[] = [...metaUseCases];
