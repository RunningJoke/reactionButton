import type { Ports } from "./ports";

/** Who calls. Users sign in with session tokens (PL1); agent tokens for AI clients come with PL4. */
export type Actor =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string; tokenId: string }
  | { kind: "agent"; userId: string; tokenId: string; clientId: string };

/** Everything a use case gets besides its input. The same for every front door. */
export type Ctx = {
  requestId: string;
  actor: Actor;
  /** granted scopes of the token (spec §6, §7.2) */
  scopes: readonly string[];
  /** which front door the call came through */
  via: "rest" | "mcp" | "internal";
  client: { ip?: string; userAgent?: string };
  ports: Ports;
};
