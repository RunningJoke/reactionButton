import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "../config";
import { connectDb } from "./db";

/** Applies the migrations in ./migrations. Run before starting a new release (deploy/compose.yaml). */
const { DATABASE_URL } = loadConfig();
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
const db = connectDb(DATABASE_URL);
await migrate(db.db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? "migrations" });
await db.close();
console.log("migrations applied");
