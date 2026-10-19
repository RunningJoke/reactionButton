import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database, Tx } from "../../adapters/db";
import { hashToken, newToken, SCOPES } from "../../core/auth";
import type { Actor } from "../../core/context";
import { uuidv7 } from "../../core/ids";
import { accessTokens } from "./schema";

/** Issues a session token for the Config App (all scopes). The token is returned once, stored hashed. */
export async function issueSession(tx: Tx, userId: string, now: Date, days: number, label: string) {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  const id = uuidv7(now.getTime());
  await tx.insert(accessTokens).values({
    id,
    userId,
    tokenHash: hashToken(token),
    kind: "session",
    scopes: [...SCOPES],
    label: label.slice(0, 120),
    createdAt: now,
    expiresAt,
  });
  return { id, token, expiresAt };
}

/** Bearer token → actor and scopes, or null if unknown, revoked or expired. Updates last use (≤ 1/min). */
export async function authenticate(
  db: Database,
  token: string,
  now: Date,
): Promise<{ actor: Actor; scopes: string[] } | null> {
  const [row] = await db
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.tokenHash, hashToken(token)), isNull(accessTokens.revokedAt), gt(accessTokens.expiresAt, now)));
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(accessTokens).set({ lastUsedAt: now }).where(eq(accessTokens.id, row.id));
  }
  const actor: Actor =
    row.kind === "agent"
      ? { kind: "agent", userId: row.userId, tokenId: row.id, clientId: row.label }
      : { kind: "user", userId: row.userId, tokenId: row.id };
  return { actor, scopes: row.scopes };
}
