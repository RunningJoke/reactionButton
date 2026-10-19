import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  /** public base URL, e.g. https://api.staging.example.org (OpenAPI servers, OAuth later) */
  PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  /** postgres://… or pglite:<folder> / pglite:memory (embedded, for development and tests) */
  DATABASE_URL: z.string().default("pglite:./.data/dev"),
  /** apply migrations at start (development / PGlite); staging runs them as a separate step */
  MIGRATE_ON_START: z.stringbool().default(false),
  /** comma-separated origins allowed by CORS (the Config App) */
  CORS_ORIGINS: z
    .string()
    .default("https://runningjoke.github.io,http://localhost:5173,http://localhost:4173,capacitor://localhost,http://localhost")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  /** the Config App; links in sign-in and invitation mails point here */
  APP_URL: z.string().url().default("https://runningjoke.github.io/reactionButton/"),
  /** SMTP, e.g. smtps://user:pass@smtp.example.org:465; empty = mails are printed to the log */
  MAIL_URL: z.string().default(""),
  MAIL_FROM: z.string().default("ReactPod <no-reply@localhost>"),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** behind Caddy: take the client IP from X-Forwarded-For */
  TRUST_PROXY: z.stringbool().default(false),
  /** folder with the shipped programs (firmware/data); the library parts are read from <dir>/prog/lib */
  SHIPPED_DATA_DIR: z.string().default("../firmware/data"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
