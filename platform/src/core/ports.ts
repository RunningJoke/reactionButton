import type { Database } from "../adapters/db";
import type { Mailer } from "../adapters/mailer";
import type { RateLimiter } from "../adapters/rateLimit";

/** Outside world as seen by the use cases (hexagonal ports). Adapters are wired in main.ts / tests. */
export type Ports = {
  db: Database;
  /** health check of the database */
  ping(): Promise<void>;
  mailer: Mailer;
  rateLimit: RateLimiter;
  /** the shipped library parts (/prog/lib/*.json → text), used when a program includes them */
  library: Readonly<Record<string, string>>;
  clock: () => Date;
  /** links in mails point into the Config App, e.g. https://runningjoke.github.io/reactionButton/ */
  appUrl: string;
  sessionDays: number;
};
