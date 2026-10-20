import { loadConfig } from "../config";
import { connectDb } from "./db";

/** Applies the migrations in ./migrations. Run before starting a new release (deploy/compose.yaml). */
const db = await connectDb(loadConfig().DATABASE_URL);
await db.migrate(process.env.MIGRATIONS_DIR ?? "migrations");
await db.close();
console.log("migrations applied");
