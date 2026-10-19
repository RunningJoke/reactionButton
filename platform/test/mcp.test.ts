import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCases } from "../src/core/registry";
import { program, testApp } from "./helpers";

const app = testApp();
let client: Client;

beforeAll(async () => {
  // the real /mcp route, with app.request as fetch
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (url, init) => app.request(String(url), init as RequestInit),
  });
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
});
afterAll(() => client.close());

describe("MCP", () => {
  it("lists one tool per use case AI clients may use", async () => {
    const { tools } = await client.listTools();
    const expected = useCases.filter((u) => u.agent !== "deny").map((u) => u.name);
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
    const validate = tools.find((t) => t.name === "validate_program")!;
    expect(validate.inputSchema.properties).toHaveProperty("files");
    expect(validate.annotations?.readOnlyHint).toBe(true);
  });

  it("calls a tool through the same use case as REST", async () => {
    const result = await client.callTool({
      name: "validate_program",
      arguments: { files: { "/prog/program.json": JSON.stringify(program) } },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ valid: true, issues: [] });
  });

  it("runs read-only use cases without arguments", async () => {
    const result = await client.callTool({ name: "get_meta", arguments: {} });
    expect(result.structuredContent).toMatchObject({ api: "v1" });
  });

  it("returns errors of the core as tool errors", async () => {
    const result = await client.callTool({ name: "validate_program", arguments: { files: "nope" } });
    expect(result.isError).toBe(true);
  });
});
