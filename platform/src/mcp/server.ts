import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BLOCK_TYPES, buildProgramSchema, ISSUE_CODES, PROGRAM_FORMAT } from "@reactpod/program-model";
import pkg from "../../package.json" with { type: "json" };
import type { Ctx } from "../core/context";
import { AppError } from "../core/errors";
import { useCases } from "../core/registry";
import { execute } from "../core/useCase";

/**
 * MCP front door (spec §7): one tool per use case that AI clients may use. Built per request, so
 * every call runs with the context (actor, scopes) of the request that carries it.
 */
export function createMcpServer(ctx: Omit<Ctx, "via">): McpServer {
  const server = new McpServer(
    { name: "reactpod-platform", title: "ReactPod platform", version: pkg.version },
    {
      instructions:
        "ReactPod reaction-training pods: find, validate and (later) publish game programs, presets and " +
        "training results. Program format: https://github.com/RunningJoke/reactionButton/blob/main/docs/firmware/programs.md",
    },
  );
  const mcpCtx: Ctx = { ...ctx, via: "mcp" };
  registerResources(server);
  for (const useCase of useCases) {
    if (useCase.agent === "deny") continue;
    server.registerTool(
      useCase.name,
      {
        title: useCase.title,
        description: useCase.description,
        inputSchema: useCase.input,
        outputSchema: useCase.output,
        annotations: { readOnlyHint: useCase.readOnly ?? false, openWorldHint: false },
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          const result = await execute(useCase, mcpCtx, args);
          return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          const problem = { code: error.code, detail: error.message, ...error.extra };
          return { isError: true, content: [{ type: "text", text: JSON.stringify(problem) }] };
        }
      },
    );
  }
  return server;
}

const json = (uri: URL, value: unknown) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }],
});

/** Reference material for writing programs (spec §7.2). */
function registerResources(server: McpServer) {
  server.registerResource(
    "program-schema",
    "reactpod://spec/program.schema.json",
    {
      title: "Program JSON Schema",
      description: `JSON Schema of a ReactPod program file (program format ${PROGRAM_FORMAT}). Check results with validate_program.`,
      mimeType: "application/json",
    },
    async (uri) => json(uri, buildProgramSchema()),
  );
  server.registerResource(
    "block-types",
    "reactpod://spec/block-types.json",
    {
      title: "Block types",
      description: "Every block type with its ports (in firmware order), fields, defaults and whether it waits.",
      mimeType: "application/json",
    },
    async (uri) => json(uri, { programFormat: PROGRAM_FORMAT, blockTypes: BLOCK_TYPES, issueCodes: ISSUE_CODES }),
  );
}
