import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Ctx } from "./context";
import { unauthorized } from "./errors";

/** Scopes of the API (spec §6). Session tokens of the app get all of them. `programs:*` covers programs, presets and sets. */
export const SCOPES = [
  "profile",
  "org:read",
  "org:write",
  "athletes:read",
  "athletes:write",
  "audit:read",
  "programs:read",
  "programs:write",
] as const;
export type Scope = (typeof SCOPES)[number];

/** Tokens and codes are stored as SHA-256 only. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** 32 random bytes, base64url (sign-in links, access tokens, invite codes). */
export const newToken = () => randomBytes(32).toString("base64url");

/** 6-digit sign-in code. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** The signed-in user's id, or 401. */
export function userId(ctx: Ctx): string {
  if (ctx.actor.kind === "anonymous") throw unauthorized();
  return ctx.actor.userId;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
