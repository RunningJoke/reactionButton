import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Ctx } from "../core/context";
import { AppError, invalidInput, notFound, toProblem, unauthorized } from "../core/errors";
import type { Ports } from "../core/ports";
import { useCases } from "../core/registry";
import { execute, pathParams, type UseCase } from "../core/useCase";
import { createMcpServer } from "../mcp/server";
import { authenticate } from "../modules/identity/tokens";
import { buildOpenApi } from "../openapi";

export type AppOptions = { ports: Ports; corsOrigins: readonly string[]; publicUrl: string; trustProxy?: boolean };

function clientIp(c: Context, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const forwarded = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined; // not running on the Node server (tests)
  }
}

/** Context for a request: the bearer token decides actor and scopes; no token = anonymous; a bad token = 401. */
async function contextFor(c: Context, ports: Ports, trustProxy: boolean): Promise<Omit<Ctx, "via">> {
  const base = {
    requestId: c.get("requestId"),
    client: { ip: clientIp(c, trustProxy), userAgent: c.req.header("User-Agent")?.slice(0, 200) },
    ports,
  };
  const header = c.req.header("Authorization");
  if (!header) return { ...base, actor: { kind: "anonymous" }, scopes: [] };
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const auth = token ? await authenticate(ports.db, token, ports.clock()) : null;
  if (!auth) throw unauthorized();
  return { ...base, ...auth };
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
export function createApp({ ports, corsOrigins, publicUrl, trustProxy = false }: AppOptions) {
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
      const ctx: Ctx = { ...(await contextFor(c, ports, trustProxy)), via: "rest" };
      const result = await execute(useCase, ctx, await readInput(c, useCase));
      return c.json(result, (useCase.http.status ?? 200) as 200);
    });
  }

  const openApi = buildOpenApi(publicUrl);
  app.get("/v1/openapi.json", (c) => c.json(openApi));

  // MCP, stateless Streamable HTTP: a new server + transport per request, JSON responses
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(await contextFor(c, ports, trustProxy));
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    try {
      await ports.ping();
      return c.json({ ok: true, db: "up" });
    } catch (error) {
      console.error("readyz: database not reachable", error);
      return c.json({ ok: false, db: "down" }, 503);
    }
  });

  return app;
}
