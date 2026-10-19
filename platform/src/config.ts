import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  /** public base URL, e.g. https://api.staging.example.org (OpenAPI servers, OAuth later) */
  PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  /** postgres://…; optional in PL0 */
  DATABASE_URL: z.string().optional(),
  /** comma-separated origins allowed by CORS (the Config App) */
  CORS_ORIGINS: z
    .string()
    .default("https://runningjoke.github.io,http://localhost:5173,http://localhost:4173,capacitor://localhost,http://localhost")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  /** folder with the shipped programs (firmware/data); the library parts are read from <dir>/prog/lib */
  SHIPPED_DATA_DIR: z.string().default("../firmware/data"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
