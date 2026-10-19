import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCases } from "../src/core/registry";
import { pseudonym } from "../src/modules/orgs/useCases";
import { program, testEnv, type TestEnv } from "./helpers";

let env: TestEnv;
const clients: Client[] = [];

/** An MCP client on the real /mcp route (app.request as fetch), optionally with a bearer token. */
async function mcp(token?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (url, init) => env.app.request(String(url), init as RequestInit),
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

beforeAll(async () => {
  env = await testEnv();
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await env.close();
});

describe("MCP", () => {
  it("lists one tool per use case AI clients may use, none of the denied ones", async () => {
    const { tools } = await (await mcp()).listTools();
    const expected = useCases.filter((u) => u.agent !== "deny").map((u) => u.name);
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
    for (const denied of ["request_login", "create_org", "create_athlete", "delete_account", "create_invite"]) {
      expect(tools.map((t) => t.name)).not.toContain(denied);
    }
    const validate = tools.find((t) => t.name === "validate_program")!;
    expect(validate.inputSchema.properties).toHaveProperty("files");
    expect(validate.annotations?.readOnlyHint).toBe(true);
  });

  it("calls a tool through the same use case as REST", async () => {
    const result = await (await mcp()).callTool({
      name: "validate_program",
      arguments: { files: { "/prog/program.json": JSON.stringify(program) } },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ valid: true, issues: [] });
  });

  it("runs read-only use cases without arguments", async () => {
    const result = await (await mcp()).callTool({ name: "get_meta", arguments: {} });
    expect(result.structuredContent).toMatchObject({ api: "v1" });
  });

  it("returns errors of the core as tool errors", async () => {
    const client = await mcp();
    expect((await client.callTool({ name: "validate_program", arguments: { files: "nope" } })).isError).toBe(true);
    expect((await client.callTool({ name: "get_me", arguments: {} })).isError).toBe(true); // not signed in
  });

  it("rejects an invalid bearer token", async () => {
    await expect(mcp("not-a-token")).rejects.toThrow();
  });

  it("acts as the signed-in user and pseudonymises athletes unless the club allows real names", async () => {
    const token = await env.signIn("coach@example.org");
    const org = (await env.call("POST", "/v1/orgs", { name: "TV Test" }, token)).body;
    const athlete = (await env.call("POST", `/v1/orgs/${org.id}/athletes`, { name: "Mia Muster", birthYear: 2014 }, token)).body;
    const client = await mcp(token);

    const me = await client.callTool({ name: "get_me", arguments: {} });
    expect(me.structuredContent).toMatchObject({ email: "coach@example.org" });

    const hidden = await client.callTool({ name: "list_athletes", arguments: { orgId: org.id } });
    expect(hidden.structuredContent).toEqual({
      athletes: [expect.objectContaining({ id: athlete.id, name: pseudonym(athlete.id), birthYear: null })],
    });
    expect(JSON.stringify(hidden.content)).not.toContain("Mia");

    const members = await client.callTool({ name: "list_members", arguments: { orgId: org.id } });
    expect(JSON.stringify(members)).not.toContain("coach@example.org");

    await env.call("PATCH", `/v1/orgs/${org.id}`, { agentRealNames: true }, token);
    const shown = await client.callTool({ name: "list_athletes", arguments: { orgId: org.id } });
    expect(shown.structuredContent).toEqual({ athletes: [expect.objectContaining({ name: "Mia Muster", birthYear: 2014 })] });

    const audit = await env.call("GET", `/v1/orgs/${org.id}/audit`, undefined, token);
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toContain("org.updated");
  });
});
