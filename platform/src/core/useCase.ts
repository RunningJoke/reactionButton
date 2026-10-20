import { z } from "zod";
import type { Ctx } from "./context";
import { AppError, forbidden, invalidInput, unauthorized } from "./errors";

/**
 * What an AI client (MCP) may do with a use case (spec §7.3):
 * allow = like any client, draft = the use case stores drafts only when `ctx.via` is "mcp", deny = not exposed.
 */
export type AgentMode = "allow" | "draft" | "deny";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type Obj = z.ZodObject<z.ZodRawShape>;

/**
 * A use case is defined once. The REST route, the OpenAPI operation and the MCP tool are generated
 * from this definition (spec §5.2), so every client gets the same validation and the same rights.
 */
export type UseCase<I extends Obj = Obj, O extends Obj = Obj> = {
  /** snake_case; MCP tool name and OpenAPI operationId */
  name: string;
  title: string;
  /** shown to API users and to AI clients – say what it does and when to use it */
  description: string;
  /** REST binding. Path in OpenAPI style, e.g. "/v1/programs/{id}"; path parameters must be input fields */
  http: { method: HttpMethod; path: string; status?: number };
  /** OpenAPI tag, usually the module */
  tag: string;
  /** scope the caller's token needs; omitted = anyone, also without login */
  scope?: string;
  agent: AgentMode;
  /** true = does not change anything (MCP readOnlyHint) */
  readOnly?: boolean;
  input: I;
  output: O;
  run(ctx: Ctx, input: z.output<I>): Promise<z.input<O>>;
};

export function defineUseCase<I extends Obj, O extends Obj>(useCase: UseCase<I, O>): UseCase<I, O> {
  return useCase;
}

/** Path parameter names of a use case ("/v1/programs/{id}" → ["id"]). */
export function pathParams(useCase: UseCase): string[] {
  return [...useCase.http.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

/**
 * Runs a use case for any front door: checks the input, the caller's rights, runs it and checks the
 * output against the contract (a broken output is a server bug, never sent to a client).
 */
export async function execute(useCase: UseCase, ctx: Ctx, rawInput: unknown): Promise<Record<string, unknown>> {
  if (ctx.via === "mcp" && useCase.agent === "deny") throw forbidden("Not available to AI clients.");
  if (useCase.scope && !ctx.scopes.includes(useCase.scope)) {
    throw ctx.actor.kind === "anonymous" ? unauthorized() : forbidden(`Needs scope ${useCase.scope}.`);
  }
  const input = useCase.input.safeParse(rawInput);
  if (!input.success) {
    throw invalidInput("The input does not match the schema.", { errors: z.treeifyError(input.error) });
  }
  const output = useCase.output.safeParse(await useCase.run(ctx, input.data));
  if (!output.success) {
    console.error(`[${ctx.requestId}] ${useCase.name}: invalid output`, z.treeifyError(output.error));
    throw new AppError(500, "internal", `Output of ${useCase.name} does not match its schema.`);
  }
  return output.data;
}
