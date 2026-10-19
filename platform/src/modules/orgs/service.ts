import type { Tx } from "../../adapters/db";
import { uuidv7 } from "../../core/ids";
import { memberships, organizations } from "./schema";

/** Every user has a personal space: an organisation of one (spec §2.2, decision P10). */
export async function createPersonalOrg(tx: Tx, userId: string, name: string, now: Date): Promise<string> {
  const id = uuidv7(now.getTime());
  await tx.insert(organizations).values({ id, kind: "personal", name, createdAt: now });
  await tx.insert(memberships).values({ orgId: id, userId, role: "owner", createdAt: now });
  return id;
}
