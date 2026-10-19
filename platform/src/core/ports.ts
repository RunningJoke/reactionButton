import type { Db } from "../adapters/db";

/** Outside world as seen by the use cases (hexagonal ports). Adapters are wired in main.ts / tests. */
export type Ports = {
  /** Postgres; undefined when DATABASE_URL is not set (PL0 runs without a database) */
  db?: Db;
  /** the shipped library parts (/prog/lib/*.json → text), used when a program includes them */
  library: Readonly<Record<string, string>>;
  clock: () => Date;
};
