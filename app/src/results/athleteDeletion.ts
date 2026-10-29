/**
 * Deleting an athlete on this phone (#48): the local athlete with all sessions and reports, the queued
 * platform deletion (self-delete for the user's own claimed profile, coach delete otherwise), and the
 * clearing of the athlete on a connected pod. Queued uploads of the athlete go with the sessions.
 */
import { usePlatformSettings } from "../platform/settings";
import { usePodSessions } from "../pod/session";
import { supportsRemote, sendAthlete } from "./podReports";
import { useResults } from "./results";

export async function deleteAthleteEverywhere(athleteId: string): Promise<void> {
  const before = useResults.getState();
  const athlete = before.athletes.find((a) => a.id === athleteId);
  if (!athlete) return;
  const claimed = athlete.platformId !== undefined && (usePlatformSettings.getState().claimedAthleteIds ?? []).includes(athlete.platformId);
  // the sets that name this athlete now (cleared by the store)
  const setIds = Object.entries(before.sets)
    .filter(([, state]) => state.athleteId === athleteId)
    .map(([setId]) => setId);

  await useResults.getState().deleteAthlete(athleteId, { claimed });

  // a connected pod stops tagging its reports with the deleted athlete (reports already on the way are dismissed anyway)
  for (const entry of usePodSessions.getState().entries) {
    const session = entry.store.getState();
    const setId = session.info?.setId.toLowerCase();
    if (!setId || !setIds.includes(setId) || session.state !== "connected" || !session.client) continue;
    if (!supportsRemote(session.info)) continue;
    await sendAthlete(session.client, "").catch(() => undefined);
  }
}
