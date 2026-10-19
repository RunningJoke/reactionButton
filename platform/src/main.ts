import { serve } from "@hono/node-server";
import pkg from "../package.json" with { type: "json" };
import { connectDb } from "./adapters/db";
import { loadLibrary } from "./adapters/library";
import { loadConfig } from "./config";
import type { Ports } from "./core/ports";
import { createApp } from "./http/app";

const config = loadConfig();
const db = config.DATABASE_URL ? connectDb(config.DATABASE_URL) : undefined;
const ports: Ports = { db, library: loadLibrary(config.SHIPPED_DATA_DIR), clock: () => new Date() };
const app = createApp({ ports, corsOrigins: config.CORS_ORIGINS, publicUrl: config.PUBLIC_URL });

const server = serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(`reactpod-platform ${pkg.version} on :${port} (db: ${db ? "postgres" : "none"}, library: ${Object.keys(ports.library).length} files)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void Promise.resolve(db?.close()).finally(() => process.exit(0));
  });
}
