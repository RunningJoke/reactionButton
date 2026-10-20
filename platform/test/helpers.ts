import { join } from "node:path";
import { connectDb } from "../src/adapters/db";
import { loadLibrary } from "../src/adapters/library";
import { memoryMailer } from "../src/adapters/mailer";
import { memoryRateLimiter } from "../src/adapters/rateLimit";
import type { Ports } from "../src/core/ports";
import { createApp } from "../src/http/app";

const library = loadLibrary(join(import.meta.dirname, "../../firmware/data"));

/** A fresh platform on an in-memory PGlite database, with captured mails and a clock the test controls. */
export async function testEnv() {
  const db = await connectDb("pglite:memory");
  await db.migrate(join(import.meta.dirname, "../migrations"));
  const mailer = memoryMailer();
  let now = new Date("2026-10-19T12:00:00Z").getTime();
  const clock = {
    now: () => new Date(now),
    advance: (ms: number) => void (now += ms),
  };
  const ports: Ports = {
    db: db.db,
    ping: db.ping,
    mailer,
    rateLimit: memoryRateLimiter(() => now),
    library,
    clock: clock.now,
    appUrl: "https://app.test/",
    sessionDays: 30,
  };
  const app = createApp({ ports, corsOrigins: ["http://localhost:5173"], publicUrl: "http://localhost:8787" });

  /** JSON request; `token` adds the Authorization header. */
  async function call(method: string, path: string, body?: unknown, token?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (text ? JSON.parse(text) : null) as any, headers: res.headers };
  }

  /** The code of the last sign-in mail to `email`. */
  function lastCode(email: string): string {
    const mail = [...mailer.sent].reverse().find((m) => m.to === email);
    const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`no sign-in mail for ${email}`);
    return code;
  }

  /** Signs in (creating the account on first use) and returns the session token. */
  async function signIn(email: string): Promise<string> {
    const req = await call("POST", "/v1/auth/login", { email });
    if (req.status !== 202) throw new Error(`login ${req.status} ${JSON.stringify(req.body)}`);
    const res = await call("POST", "/v1/auth/verify", { email, code: lastCode(email) });
    if (res.status !== 200) throw new Error(`verify ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken as string;
  }

  return { app, ports, db, mailer, clock, call, signIn, lastCode, close: () => db.close() };
}

export type TestEnv = Awaited<ReturnType<typeof testEnv>>;

/** A small valid program. */
export const program = {
  version: 1,
  name: "Test",
  start: "Blink",
  blocks: [
    { name: "Blink", type: "led", color: "red", next: "Wait" },
    { name: "Wait", type: "delay", ms: 500, next: "Blink" },
  ],
};
