/**
 * Glue between a pod connection and the results store: started by the pod session after
 * connecting, only for pods with the "reports" feature (#41). Without it nothing happens.
 */
import type { PodClient } from "../pod/client";
import type { InfoResponse } from "../pod/protocol";
import { ReportFeed, sendAthlete, supportsRemote, supportsReports } from "./podReports";
import { useResults } from "./results";

export type ResultLinkOptions = {
  /** text of a pod file, if the app read it (for the content hash of the session) */
  programText: (path: string) => string | undefined;
  log: (text: string) => void;
};

export async function sha256Hex(text: string): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined; // no WebCrypto (plain http)
  }
}

/** Starts receiving reports. `started` resolves after the pending reports were fetched. */
export function linkResults(client: PodClient, info: InfoResponse, options: ResultLinkOptions): { stop: () => void; started: Promise<void> } {
  if (!supportsReports(info)) return { stop: () => undefined, started: Promise.resolve() };
  const results = useResults.getState();
  const feed = new ReportFeed(
    client,
    async (report) => {
      const text = options.programText(report.program);
      const contentSha256 = text === undefined ? undefined : await sha256Hex(text);
      const { durable, duplicate, dismissed } = await useResults.getState().receiveReport(report, { contentSha256, podTagsAthlete: supportsRemote(info) });
      if (dismissed) {
        options.log(`report ${report.id} of a deleted athlete: dismissed`);
        return { durable: true };
      }
      options.log(`report ${report.id} ${duplicate ? "(again) " : ""}${durable ? "stored" : "kept in memory only, not acknowledged"}`);
      return { durable };
    },
    (e) => options.log(`reports: ${e instanceof Error ? e.message : String(e)}`),
  );
  const started = (async () => {
    await results.load();
    // the pod forgets the athlete after a restart; tell it again (#42)
    const athleteId = useResults.getState().sets[info.setId.toLowerCase()]?.athleteId;
    if (supportsRemote(info) && athleteId) await sendAthlete(client, athleteId).catch((e: unknown) => options.log(`session: ${String(e)}`));
    await feed.start();
  })().catch((e: unknown) => options.log(`reports: ${String(e)}`));
  return { stop: () => feed.stop(), started };
}
