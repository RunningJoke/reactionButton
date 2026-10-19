import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
