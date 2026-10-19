import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import type { Ctx } from "../core/context";
import { AppError, invalidInput, notFound, toProblem } from "../core/errors";
import type { Ports } from "../core/ports";
import { useCases } from "../core/registry";
import { execute, pathParams, type UseCase } from "../core/useCase";
import { createMcpServer } from "../mcp/server";
import { buildOpenApi } from "../openapi";

export type AppOptions = { ports: Ports; corsOrigins: readonly string[]; publicUrl: string };

/** Context for a request. PL0: everyone is anonymous; PL1 reads the bearer token here. */
function contextFor(c: Context, ports: Ports): Omit<Ctx, "via"> {
  return { requestId: c.get("requestId"), actor: { kind: "anonymous" }, scopes: [], ports };
}

async function readInput(c: Context, useCase: UseCase): Promise<Record<string, unknown>> {
  const params = Object.fromEntries(pathParams(useCase).map((p) => [p, c.req.param(p)]));
  if (useCase.http.method === "get" || useCase.http.method === "delete") return { ...c.req.query(), ...params };
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw invalidInput("The body must be JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalidInput("The body must be a JSON object.");
  return { ...body, ...params };
}

/** The REST front door (spec §6) plus /mcp, health checks and the OpenAPI document. */
export function createApp({ ports, corsOrigins, publicUrl }: AppOptions) {
  const app = new Hono();
  app.use(requestId());
  app.use(
    "/v1/*",
    cors({ origin: [...corsOrigins], allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "If-Match"] }),
  );

  app.onError((error, c) => {
    const appError = error instanceof AppError ? error : new AppError(500, "internal", "Internal error.");
    if (appError.status >= 500) console.error(`[${c.get("requestId")}]`, error);
    return c.json(toProblem(appError, c.req.path), appError.status as 400, { "Content-Type": "application/problem+json" });
  });
  app.notFound((c) => {
    throw notFound(`No route ${c.req.method} ${c.req.path}.`);
  });

  for (const useCase of useCases) {
    const path = useCase.http.path.replace(/\{(\w+)\}/g, ":$1");
    app.on(useCase.http.method.toUpperCase(), path, async (c) => {
      const ctx: Ctx = { ...contextFor(c, ports), via: "rest" };
      const result = await execute(useCase, ctx, await readInput(c, useCase));
      return c.json(result, (useCase.http.status ?? 200) as 200);
    });
  }

  const openApi = buildOpenApi(publicUrl);
  app.get("/v1/openapi.json", (c) => c.json(openApi));

  // MCP, stateless Streamable HTTP: a new server + transport per request, JSON responses
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(contextFor(c, ports));
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    if (!ports.db) return c.json({ ok: true, db: "none" });
    try {
      await ports.db.ping();
      return c.json({ ok: true, db: "up" });
    } catch (error) {
      console.error("readyz: database not reachable", error);
      return c.json({ ok: false, db: "down" }, 503);
    }
  });

  return app;
}
