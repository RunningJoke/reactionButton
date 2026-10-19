import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/** Postgres via postgres.js + Drizzle. Tables come with PL1 (src/modules/<module>/schema.ts). */
export function connectDb(url: string) {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client);
  return {
    db,
    async ping(): Promise<void> {
      await db.execute(sql`select 1`);
    },
    close: () => client.end({ timeout: 5 }),
  };
}

export type Db = ReturnType<typeof connectDb>;
