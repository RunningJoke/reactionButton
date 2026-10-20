import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../db/schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A database or an open transaction; use cases accept both. */
export type Tx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type Db = {
  db: Database;
  ping(): Promise<void>;
  migrate(migrationsFolder: string): Promise<void>;
  close(): Promise<void>;
};

/**
 * Postgres via postgres.js (`postgres://…`) or embedded PGlite (`pglite:memory`, `pglite:<folder>`)
 * for tests and development without a database server. PGlite is loaded only when used (it is not
 * part of the production bundle).
 */
export async function connectDb(url: string): Promise<Db> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
    const { migrate: migratePglite } = await import("drizzle-orm/pglite/migrator");
    const where = url.slice("pglite:".length);
    const client = new PGlite(where === "memory" ? undefined : where);
    const db = drizzlePglite(client, { schema });
    return {
      db: db as unknown as Database,
      ping: async () => void (await db.execute(sql`select 1`)),
      migrate: (migrationsFolder) => migratePglite(db, { migrationsFolder }),
      close: () => client.close(),
    };
  }
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema });
  return {
    db: db as unknown as Database,
    ping: async () => void (await db.execute(sql`select 1`)),
    migrate: (migrationsFolder) => migratePostgres(db, { migrationsFolder }),
    close: () => client.end({ timeout: 5 }),
  };
}
