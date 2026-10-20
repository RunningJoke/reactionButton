import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import pkg from "../package.json" with { type: "json" };
import { connectDb } from "./adapters/db";
import { loadLibrary } from "./adapters/library";
import { consoleMailer, smtpMailer } from "./adapters/mailer";
import { memoryRateLimiter } from "./adapters/rateLimit";
import { loadConfig } from "./config";
import type { Ports } from "./core/ports";
import { createApp } from "./http/app";

const config = loadConfig();
if (config.DATABASE_URL.startsWith("pglite:./")) mkdirSync(config.DATABASE_URL.slice("pglite:".length), { recursive: true });
const db = await connectDb(config.DATABASE_URL);
if (config.MIGRATE_ON_START || config.DATABASE_URL.startsWith("pglite:")) {
  await db.migrate(process.env.MIGRATIONS_DIR ?? "migrations");
}

const ports: Ports = {
  db: db.db,
  ping: db.ping,
  mailer: config.MAIL_URL ? smtpMailer(config.MAIL_URL, config.MAIL_FROM) : consoleMailer,
  rateLimit: memoryRateLimiter(),
  library: loadLibrary(config.SHIPPED_DATA_DIR),
  clock: () => new Date(),
  appUrl: config.APP_URL,
  sessionDays: config.SESSION_DAYS,
};
const app = createApp({ ports, corsOrigins: config.CORS_ORIGINS, publicUrl: config.PUBLIC_URL, trustProxy: config.TRUST_PROXY });

const dbKind = config.DATABASE_URL.startsWith("pglite:") ? "pglite" : "postgres";
const server = serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(
    `reactpod-platform ${pkg.version} on :${port} (db: ${dbKind}, mail: ${config.MAIL_URL ? "smtp" : "console"}, library: ${Object.keys(ports.library).length} files)`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void db.close().finally(() => process.exit(0));
  });
}
