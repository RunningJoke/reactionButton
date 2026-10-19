import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROGRAM_FORMAT } from "@reactpod/program-model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { program, testEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
afterAll(() => env.close());
const request = (path: string, init?: RequestInit) => env.app.request(path, init);
const post = (path: string, body: unknown) =>
  request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("REST", () => {
  it("GET /v1/meta tells version, program format and features", async () => {
    const res = await request("/v1/meta");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ api: "v1", programFormat: PROGRAM_FORMAT, features: expect.arrayContaining(["validate", "accounts", "orgs"]) });
  });

  it("validates a valid program", async () => {
    const res = await post("/v1/programs/validate", { path: "/prog/test.json", files: { "/prog/test.json": JSON.stringify(program) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, issues: [] });
  });

  it("resolves includes of the shipped library", async () => {
    const text = readFileSync(join(import.meta.dirname, "../../firmware/data/prog/solo.json"), "utf8");
    const res = await post("/v1/programs/validate", { path: "/prog/solo.json", files: { "/prog/solo.json": text } });
    expect(((await res.json()) as { valid: boolean }).valid).toBe(true);
  });

  it("reports issues with the app's issue codes", async () => {
    const broken = { ...program, blocks: [{ name: "Blink", type: "led", color: "red", next: "Missing" }] };
    const res = await post("/v1/programs/validate", { files: { "/prog/program.json": JSON.stringify(broken) } });
    const body = (await res.json()) as { valid: boolean; issues: { code: string }[] };
    expect(body.valid).toBe(false);
    expect(body.issues.map((i) => i.code)).toContain("portUnknownTarget");
  });

  it("answers invalid input with problem+json", async () => {
    const res = await post("/v1/programs/validate", { files: "nope" });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/problem+json");
    expect(await res.json()).toMatchObject({ title: "invalid_input", status: 400 });
  });

  it("answers unknown routes with 404 problem+json", async () => {
    const res = await request("/v1/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ title: "not_found" });
  });

  it("allows the app origin via CORS", async () => {
    const res = await request("/v1/meta", { headers: { Origin: "http://localhost:5173" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("has health checks", async () => {
    expect(await (await request("/healthz")).json()).toEqual({ ok: true });
    expect(await (await request("/readyz")).json()).toEqual({ ok: true, db: "up" });
  });
});
