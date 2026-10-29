/**
 * Athletes, training sessions and reports on the phone (issue #47). Every change is written to the
 * storage before the promise resolves, so a report can be acknowledged to the pod afterwards.
 */
import { create } from "zustand";
import { sameReport, type Athlete, type PodReport, type StoredReport, type TrainingSession } from "./report";
import { createResultStorage, type ResultStorage } from "./resultStore";

/** Per pod set: the assigned athlete and the session reports go into. */
export type SetState = { athleteId: string | null; sessionId?: string };

/**
 * A deletion on the platform that waits for the phone to be online and signed in (issue #48). Kept
 * until the platform answered (deleted, or gone already); queued while offline, like the uploads.
 */
export type PlatformDelete = {
  id: string;
  kind: "athlete" | "session";
  orgId: string;
  /** platform athlete id, or the session's platform id (`upload.remoteId`) */
  platformId: string;
};

export type ReceiveResult = {
  report: StoredReport;
  /** already stored before (event and `reports` after a reconnect, or a lost `ack`) */
  duplicate: boolean;
  /** written to IndexedDB: only then may the pod get its `ack` */
  durable: boolean;
};

type Results = {
  loaded: boolean;
  storage: ResultStorage;
  /** false when IndexedDB is not available (private mode): reports are kept in memory only */
  durable: boolean;
  athletes: Athlete[];
  sessions: TrainingSession[];
  reports: StoredReport[];
  sets: Record<string, SetState>;
  /** deletions to repeat on the platform (see PlatformDelete) */
  platformDeletes: PlatformDelete[];

  load: () => Promise<void>;
  addAthlete: (name: string) => Promise<Athlete>;
  updateAthlete: (id: string, patch: Partial<Pick<Athlete, "name" | "platformId" | "platformOrgId">>) => Promise<void>;
  /** deletes the athlete with their sessions and reports */
  deleteAthlete: (id: string) => Promise<void>;
  /** the athlete who trains on a set now (null = nobody); the next report starts a new session */
  assign: (setId: string, athleteId: string | null) => Promise<void>;
  /** stores a report from a pod; resolves after it is written */
  receiveReport: (report: PodReport, options?: { contentSha256?: string; now?: number; podTagsAthlete?: boolean }) => Promise<ReceiveResult>;
  setDiscarded: (reportId: string, discarded: boolean) => Promise<void>;
  /** the last report of the set's current session was followed by `repeat` */
  discardLast: (setId: string) => Promise<StoredReport | undefined>;
  /** only before the session was uploaded (the platform keeps a session's athlete) */
  setSessionAthlete: (sessionId: string, athleteId: string | null) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /** remembers a successful upload: the session's platform id and the uploaded reports' flags */
  recordUpload: (sessionId: string, remoteId: string, reports: { id: string; discarded: boolean }[], at?: number) => Promise<void>;
  recordUploadError: (sessionId: string, error: string, at?: number) => Promise<void>;
  /** the platform answered a queued deletion: it is no longer repeated */
  finishPlatformDelete: (id: string) => Promise<void>;
};

const SETS_KEY = "sets";
const PLATFORM_DELETES_KEY = "platformDeletes";

/** Serialises writes, so two reports of one set cannot open two sessions. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}

const byTime = <T extends { startedAt?: number; recordedAt?: number }>(a: T, b: T) =>
  (a.startedAt ?? a.recordedAt ?? 0) - (b.startedAt ?? b.recordedAt ?? 0);

export const useResults = create<Results>((set, get) => {
  /** Writes with the storage; on failure (blocked IndexedDB) keeps working in memory. */
  const write = async (run: (s: ResultStorage) => Promise<void>) => {
    try {
      await run(get().storage);
      return true;
    } catch {
      set({ durable: false });
      return false;
    }
  };
  const saveSets = (sets: Record<string, SetState>) => {
    set({ sets });
    return write((s) => s.setMeta(SETS_KEY, sets));
  };
  const saveSession = (session: TrainingSession) => {
    set((s) => ({ sessions: [...s.sessions.filter((x) => x.id !== session.id), session].sort(byTime) }));
    return write((s) => s.saveSession(session));
  };
  const saveReports = (reports: StoredReport[]) => {
    const ids = new Set(reports.map((r) => r.id));
    set((s) => ({ reports: [...s.reports.filter((r) => !ids.has(r.id)), ...reports].sort(byTime) }));
    return write((s) => s.saveReports(reports));
  };
  const removeSessions = async (ids: ReadonlySet<string>) => {
    const reportIds = get()
      .reports.filter((r) => ids.has(r.sessionId))
      .map((r) => r.id);
    set((s) => ({ sessions: s.sessions.filter((x) => !ids.has(x.id)), reports: s.reports.filter((r) => !ids.has(r.sessionId)) }));
    await write(async (s) => {
      await s.deleteReports(reportIds);
      for (const id of ids) await s.deleteSession(id);
    });
  };
  /** Queues platform deletions (kept in the storage, so they survive a restart). */
  const queueDeletes = async (items: Omit<PlatformDelete, "id">[]) => {
    if (items.length === 0) return;
    const next = [...get().platformDeletes, ...items.map((item) => ({ ...item, id: crypto.randomUUID() }))];
    set({ platformDeletes: next });
    await write((s) => s.setMeta(PLATFORM_DELETES_KEY, next));
  };

  return {
    loaded: false,
    storage: createResultStorage(),
    durable: true,
    athletes: [],
    sessions: [],
    reports: [],
    sets: {},
    platformDeletes: [],

    async load() {
      if (get().loaded) return;
      const { storage } = get();
      try {
        const [athletes, sessions, reports, sets, platformDeletes] = await Promise.all([
          storage.listAthletes(),
          storage.listSessions(),
          storage.listReports(),
          storage.getMeta<Record<string, SetState>>(SETS_KEY),
          storage.getMeta<PlatformDelete[]>(PLATFORM_DELETES_KEY),
        ]);
        set({
          athletes: athletes.sort((a, b) => a.name.localeCompare(b.name)),
          sessions: sessions.sort(byTime),
          reports: reports.sort(byTime),
          sets: sets ?? {},
          platformDeletes: platformDeletes ?? [],
          durable: storage.durable,
          loaded: true,
        });
      } catch {
        set({ loaded: true, durable: false });
      }
    },

    addAthlete: (name) =>
      serial(async () => {
        const athlete: Athlete = { id: crypto.randomUUID(), name: name.trim(), createdAt: Date.now() };
        set((s) => ({ athletes: [...s.athletes, athlete].sort((a, b) => a.name.localeCompare(b.name)) }));
        await write((s) => s.saveAthlete(athlete));
        return athlete;
      }),

    updateAthlete: (id, patch) =>
      serial(async () => {
        const old = get().athletes.find((a) => a.id === id);
        if (!old) return;
        const athlete: Athlete = { ...old, ...patch };
        if (patch.name !== undefined) athlete.name = patch.name.trim();
        for (const key of ["platformId", "platformOrgId"] as const) if (key in patch && patch[key] === undefined) delete athlete[key];
        set((s) => ({ athletes: s.athletes.map((a) => (a.id === id ? athlete : a)).sort((a, b) => a.name.localeCompare(b.name)) }));
        await write((s) => s.saveAthlete(athlete));
      }),

    deleteAthlete: (id) =>
      serial(async () => {
        const athlete = get().athletes.find((a) => a.id === id);
        // the platform deletes the profile with its sessions (P24)
        if (athlete?.platformId && athlete.platformOrgId) await queueDeletes([{ kind: "athlete", orgId: athlete.platformOrgId, platformId: athlete.platformId }]);
        await removeSessions(new Set(get().sessions.filter((s) => s.athleteId === id).map((s) => s.id)));
        set((s) => ({ athletes: s.athletes.filter((a) => a.id !== id) }));
        await write((s) => s.deleteAthlete(id));
        const sets = Object.fromEntries(Object.entries(get().sets).map(([k, v]) => [k, v.athleteId === id ? { athleteId: null } : v]));
        await saveSets(sets);
      }),

    assign: (setId, athleteId) =>
      serial(async () => {
        const current = get().sets[setId];
        if (current && current.athleteId === athleteId) return;
        await saveSets({ ...get().sets, [setId]: { athleteId } });
      }),

    receiveReport: (report, options = {}) =>
      serial(async () => {
        const now = options.now ?? Date.now();
        const { sets, sessions, reports, athletes } = get();
        const setId = report.setId;
        const state = sets[setId] ?? { athleteId: null };
        // a pod that knows `session` (#42) names the athlete of the report itself (none = nobody, also
        // when the report was recorded before the athlete was chosen); else the app's assignment counts
        const tagged = report.athlete !== undefined ? athletes.find((a) => a.id === report.athlete) : undefined;
        const athleteId = options.podTagsAthlete ? (tagged?.id ?? null) : (tagged?.id ?? state.athleteId);

        let session = state.sessionId ? sessions.find((s) => s.id === state.sessionId) : undefined;
        if (session) {
          const duplicate = reports.find((r) => r.sessionId === session!.id && sameReport(r, report));
          if (duplicate) return { report: duplicate, duplicate: true, durable: get().durable };
        }
        if (!session || session.athleteId !== athleteId || session.programPath !== report.program) {
          session = {
            id: crypto.randomUUID(),
            athleteId,
            setId,
            programPath: report.program,
            startedAt: now,
            notes: "",
            upload: {},
          };
          if (options.contentSha256) session.contentSha256 = options.contentSha256;
          await saveSession(session);
          await saveSets({ ...get().sets, [setId]: { athleteId: state.athleteId, sessionId: session.id } });
        }
        const stored: StoredReport = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          podReportId: report.id,
          recordedAt: now,
          discarded: false,
          values: report.values,
          stats: report.stats,
          vars: report.vars,
        };
        if (report.cycle !== undefined) stored.cycle = report.cycle;
        if (report.startMs !== undefined) stored.startMs = report.startMs;
        if (report.endMs !== undefined) stored.endMs = report.endMs;
        const ok = await saveReports([stored]);
        return { report: stored, duplicate: false, durable: ok && get().durable };
      }),

    setDiscarded: (reportId, discarded) =>
      serial(async () => {
        const report = get().reports.find((r) => r.id === reportId);
        if (!report || report.discarded === discarded) return;
        await saveReports([{ ...report, discarded }]);
      }),

    discardLast: (setId) =>
      serial(async () => {
        const sessionId = get().sets[setId]?.sessionId;
        const last = get()
          .reports.filter((r) => r.sessionId === sessionId)
          .at(-1);
        if (!last || last.discarded) return last;
        const next = { ...last, discarded: true };
        await saveReports([next]);
        return next;
      }),

    setSessionAthlete: (sessionId, athleteId) =>
      serial(async () => {
        const session = get().sessions.find((s) => s.id === sessionId);
        if (!session || session.upload.remoteId) return;
        await saveSession({ ...session, athleteId });
      }),

    deleteSession: (id) =>
      serial(async () => {
        const session = get().sessions.find((s) => s.id === id);
        const orgId = get().athletes.find((a) => a.id === session?.athleteId)?.platformOrgId;
        if (session?.upload.remoteId && orgId) await queueDeletes([{ kind: "session", orgId, platformId: session.upload.remoteId }]);
        await removeSessions(new Set([id]));
        const sets = Object.fromEntries(Object.entries(get().sets).map(([k, v]) => [k, v.sessionId === id ? { athleteId: v.athleteId } : v]));
        await saveSets(sets);
      }),

    recordUpload: (sessionId, remoteId, uploaded, at = Date.now()) =>
      serial(async () => {
        const session = get().sessions.find((s) => s.id === sessionId);
        if (!session) return;
        await saveSession({ ...session, upload: { remoteId, uploadedAt: at } });
        const flags = new Map(uploaded.map((r) => [r.id, r.discarded]));
        const changed = get()
          .reports.filter((r) => flags.has(r.id))
          .map((r) => ({ ...r, uploadedDiscarded: flags.get(r.id)! }));
        if (changed.length) await saveReports(changed);
      }),

    recordUploadError: (sessionId, error, at = Date.now()) =>
      serial(async () => {
        const session = get().sessions.find((s) => s.id === sessionId);
        if (!session) return;
        await saveSession({ ...session, upload: { ...session.upload, error, errorAt: at } });
      }),

    finishPlatformDelete: (id) =>
      serial(async () => {
        const next = get().platformDeletes.filter((d) => d.id !== id);
        set({ platformDeletes: next });
        await write((s) => s.setMeta(PLATFORM_DELETES_KEY, next));
      }),
  };
});

/** Reports of a session in recording order. */
export function reportsOfSession(reports: readonly StoredReport[], sessionId: string): StoredReport[] {
  return reports.filter((r) => r.sessionId === sessionId);
}

/** A report that the platform does not have yet, or with another `discarded` flag. */
export function needsUpload(r: StoredReport): boolean {
  return r.uploadedDiscarded !== r.discarded;
}

export type SessionUploadStatus = "noAthlete" | "notLinked" | "pending" | "failed" | "uploaded" | "empty";

/** What the history shows per session. */
export function sessionUploadStatus(session: TrainingSession, athletes: readonly Athlete[], reports: readonly StoredReport[]): SessionUploadStatus {
  const own = reportsOfSession(reports, session.id);
  if (own.length === 0) return "empty";
  if (!own.some(needsUpload)) return "uploaded";
  if (!session.athleteId) return "noAthlete";
  const athlete = athletes.find((a) => a.id === session.athleteId);
  if (!athlete?.platformId) return "notLinked";
  return session.upload.error && (session.upload.errorAt ?? 0) >= (session.upload.uploadedAt ?? 0) ? "failed" : "pending";
}
