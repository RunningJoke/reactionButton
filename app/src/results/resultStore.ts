/**
 * Persistence of athletes, training sessions and reports (issue #47). Pods keep reports in RAM only,
 * so the phone is the first safe place: a report is acknowledged to the pod only after `saveReport`
 * resolved (IndexedDB transaction complete). Separate database from the programs ("reactpod-local").
 */
import { openDB, type IDBPDatabase } from "idb";
import type { Athlete, StoredReport, TrainingSession } from "./report";

export interface ResultStorage {
  /** false when data is kept in memory only (IndexedDB blocked): reports are then not acknowledged */
  readonly durable: boolean;
  listAthletes(): Promise<Athlete[]>;
  saveAthlete(athlete: Athlete): Promise<void>;
  deleteAthlete(id: string): Promise<void>;
  listSessions(): Promise<TrainingSession[]>;
  saveSession(session: TrainingSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listReports(): Promise<StoredReport[]>;
  saveReports(reports: StoredReport[]): Promise<void>;
  deleteReports(ids: string[]): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export class MemoryResultStorage implements ResultStorage {
  private athletes = new Map<string, Athlete>();
  private sessions = new Map<string, TrainingSession>();
  private reports = new Map<string, StoredReport>();
  private meta = new Map<string, unknown>();
  /** tests pass true to act like IndexedDB */
  constructor(readonly durable = false) {}

  async listAthletes() {
    return [...this.athletes.values()].map((a) => structuredClone(a));
  }
  async saveAthlete(athlete: Athlete) {
    this.athletes.set(athlete.id, structuredClone(athlete));
  }
  async deleteAthlete(id: string) {
    this.athletes.delete(id);
  }
  async listSessions() {
    return [...this.sessions.values()].map((s) => structuredClone(s));
  }
  async saveSession(session: TrainingSession) {
    this.sessions.set(session.id, structuredClone(session));
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async listReports() {
    return [...this.reports.values()].map((r) => structuredClone(r));
  }
  async saveReports(reports: StoredReport[]) {
    for (const r of reports) this.reports.set(r.id, structuredClone(r));
  }
  async deleteReports(ids: string[]) {
    for (const id of ids) this.reports.delete(id);
  }
  async getMeta<T>(key: string) {
    const value = this.meta.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }
  async setMeta(key: string, value: unknown) {
    if (value === undefined) this.meta.delete(key);
    else this.meta.set(key, structuredClone(value));
  }
}

export class IdbResultStorage implements ResultStorage {
  readonly durable = true;
  private db: Promise<IDBPDatabase> | null = null;

  private open() {
    this.db ??= openDB("reactpod-results", 1, {
      upgrade(db) {
        db.createObjectStore("athletes", { keyPath: "id" });
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("reports", { keyPath: "id" }).createIndex("sessionId", "sessionId");
        db.createObjectStore("meta");
      },
    });
    return this.db;
  }

  async listAthletes() {
    return (await (await this.open()).getAll("athletes")) as Athlete[];
  }
  async saveAthlete(athlete: Athlete) {
    await (await this.open()).put("athletes", athlete);
  }
  async deleteAthlete(id: string) {
    await (await this.open()).delete("athletes", id);
  }
  async listSessions() {
    return (await (await this.open()).getAll("sessions")) as TrainingSession[];
  }
  async saveSession(session: TrainingSession) {
    await (await this.open()).put("sessions", session);
  }
  async deleteSession(id: string) {
    await (await this.open()).delete("sessions", id);
  }
  async listReports() {
    return (await (await this.open()).getAll("reports")) as StoredReport[];
  }
  async saveReports(reports: StoredReport[]) {
    const tx = (await this.open()).transaction("reports", "readwrite");
    await Promise.all([...reports.map((r) => tx.store.put(r)), tx.done]);
  }
  async deleteReports(ids: string[]) {
    const tx = (await this.open()).transaction("reports", "readwrite");
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }
  async getMeta<T>(key: string) {
    return (await (await this.open()).get("meta", key)) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    const db = await this.open();
    if (value === undefined) await db.delete("meta", key);
    else await db.put("meta", value, key);
  }
}

export function createResultStorage(): ResultStorage {
  return typeof indexedDB === "undefined" ? new MemoryResultStorage() : new IdbResultStorage();
}
