import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { useCases } from "./core/registry";
import { pathParams, type UseCase } from "./core/useCase";

const jsonSchema = (schema: z.core.$ZodType, io: "input" | "output") => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
};

const Problem = {
  type: "object",
  description: "RFC 9457 problem details",
  properties: {
    type: { type: "string" },
    title: { type: "string", description: "stable error code, e.g. invalid_input" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
  },
  required: ["type", "title", "status", "detail"],
};

function operation(useCase: UseCase) {
  const params = pathParams(useCase);
  const shape = useCase.input.shape;
  const hasBody = ["post", "put", "patch"].includes(useCase.http.method);
  const omit = Object.fromEntries(params.map((p) => [p, true] as const));
  const rest = useCase.input.omit(omit);
  const parameters = [
    ...params.map((name) => ({ name, in: "path", required: true, schema: jsonSchema(shape[name]!, "input") })),
    ...(hasBody
      ? []
      : Object.entries(rest.shape as z.ZodRawShape).map(([name, schema]) => ({
          name,
          in: "query",
          required: !z.safeParse(schema, undefined).success,
          schema: jsonSchema(schema, "input"),
        }))),
  ];
  const problem = { content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };
  return {
    operationId: useCase.name,
    summary: useCase.title,
    description: useCase.description,
    tags: [useCase.tag],
    ...(useCase.scope ? { security: [{ bearer: [useCase.scope] }] } : {}),
    "x-agent": useCase.agent,
    ...(parameters.length ? { parameters } : {}),
    ...(hasBody
      ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(rest, "input") } } } }
      : {}),
    responses: {
      [String(useCase.http.status ?? 200)]: {
        description: "OK",
        content: { "application/json": { schema: jsonSchema(useCase.output, "output") } },
      },
      "400": { description: "Invalid input", ...problem },
      ...(useCase.scope
        ? { "401": { description: "Not signed in", ...problem }, "403": { description: "Not allowed", ...problem } }
        : {}),
    },
  };
}

/** OpenAPI 3.1 document of the REST API, generated from the use cases (checked in as spec/platform-api.yaml). */
export function buildOpenApi(serverUrl = "https://api.example.org") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const useCase of useCases) {
    (paths[useCase.http.path] ??= {})[useCase.http.method] = operation(useCase);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "ReactPod platform API",
      version: pkg.version,
      description:
        "REST API of the ReactPod community platform (docs/platform/spec.md). Generated from the use cases in " +
        "platform/src – do not edit by hand. AI clients use the same operations as MCP tools at /mcp.",
    },
    servers: [{ url: serverUrl }],
    tags: [...new Set(useCases.map((u) => u.tag))].map((name) => ({ name })),
    paths,
    components: {
      schemas: { Problem },
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "OAuth 2.1 access token or personal access token (PL1)" } },
    },
  };
}
