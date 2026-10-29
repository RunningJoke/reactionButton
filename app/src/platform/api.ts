/**
 * Small typed client for the community platform API (spec/platform-api.yaml, docs/platform/spec.md §6).
 * Only what the app uses so far: meta, sign-in, clubs, athletes and the training upload.
 * Bearer token from the settings; errors are problem+json with a stable `code`.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class PlatformError extends Error {
  constructor(
    /** HTTP status, 0 = no answer (offline, CORS, DNS) */
    readonly status: number,
    /** problem+json `title` (stable code), "network" or "http" */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }

  /** worth another try later: no answer, rate limit or server trouble */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export type Meta = { api: "v1"; version: string; programFormat: number; features: string[] };
export type User = {
  id: string;
  email: string;
  displayName?: string;
  locale: "en" | "de";
  /** athlete profiles this user claimed (GET /v1/me); missing on older platforms */
  athleteProfiles?: { athleteId: string; orgId: string; name: string }[];
};
export type Org = { id: string; name: string; kind: string; role: string; teamIds: string[] };
export type PlatformAthlete = {
  id: string;
  orgId: string;
  name: string;
  birthYear: number | null;
  teamIds: string[];
  claimed: boolean;
  consentAt: string | null;
  createdAt: string;
};

export type ValueIn = { t: number; metric: string; pod: number; ms: number };
export type ReportIn = {
  id: string;
  podReportId?: number;
  cycle?: number;
  startMs?: number;
  endMs?: number;
  recordedAt: string;
  discarded: boolean;
  values: ValueIn[];
  stats: Record<string, { count: number; average: number; best: number; worst: number }>;
  vars: Record<string, number>;
};
export type SessionIn = {
  id: string;
  athleteId: string;
  setId?: string;
  programPath: string;
  revisionId?: string;
  presetId?: string;
  contentSha256?: string;
  startedAt: string;
  notes?: string;
  reports: ReportIn[];
};
export type UploadResult = {
  sessions: { clientId: string; id: string; created: boolean }[];
  reports: { clientId: string; id: string; status: "created" | "updated" | "unchanged" }[];
};

/** Upload limits of POST /training/upload (platform useCases.ts). */
export const UPLOAD_LIMITS = { sessions: 50, reportsPerSession: 200, values: 20_000, valuesPerReport: 2000 } as const;

export type PlatformClientOptions = {
  baseUrl: string;
  token?: string;
  fetch?: Fetch;
};

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly fetchFn: Fetch;

  constructor(private readonly options: PlatformClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const init: RequestInit = { method, headers: { Accept: "application/json", ...headers } };
    if (this.options.token) (init.headers as Record<string, string>).Authorization = `Bearer ${this.options.token}`;
    if (body !== undefined) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, init);
    } catch (e) {
      throw new PlatformError(0, "network", e instanceof Error ? e.message : String(e));
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const problem = (json ?? {}) as { title?: string; detail?: string };
      throw new PlatformError(response.status, problem.title ?? "http", problem.detail ?? `HTTP ${response.status}`);
    }
    return json as T;
  }

  meta() {
    return this.request<Meta>("GET", "/v1/meta");
  }
  /** Sends a mail with a 6-digit code and a link (always 202). */
  requestLogin(email: string, locale: "en" | "de") {
    return this.request<{ ok: true }>("POST", "/v1/auth/login", { email, locale });
  }
  /** With the link `token`, or `email` + `code`. */
  verifyLogin(input: { token: string } | { email: string; code: string }) {
    return this.request<{ accessToken: string; expiresAt: string; user: User; created: boolean }>("POST", "/v1/auth/verify", input);
  }
  me() {
    return this.request<User>("GET", "/v1/me");
  }
  listOrgs() {
    return this.request<{ orgs: Org[] }>("GET", "/v1/orgs");
  }
  listAthletes(orgId: string) {
    return this.request<{ athletes: PlatformAthlete[] }>("GET", `/v1/orgs/${encodeURIComponent(orgId)}/athletes`);
  }
  /** `consent: true`: the coach confirms the athlete's (for minors: the parents') consent (P23). */
  createAthlete(orgId: string, input: { name: string; birthYear?: number; teamIds?: string[]; consent: true }) {
    return this.request<PlatformAthlete>("POST", `/v1/orgs/${encodeURIComponent(orgId)}/athletes`, input);
  }
  /** Idempotent by the app's session and report ids (P22). */
  uploadTraining(orgId: string, sessions: SessionIn[]) {
    return this.request<UploadResult>("POST", `/v1/orgs/${encodeURIComponent(orgId)}/training/upload`, { sessions });
  }
  /** Deletes the athlete profile with its sessions and reports (P24). */
  deleteAthlete(orgId: string, athleteId: string) {
    return this.request<{ ok: true }>("DELETE", `/v1/orgs/${encodeURIComponent(orgId)}/athletes/${encodeURIComponent(athleteId)}`);
  }
  /** The signed-in user deletes the athlete profile they claimed, with its results and links (self-delete). */
  deleteMyAthleteProfile(orgId: string, athleteId: string) {
    return this.request<{ ok: true }>(
      "DELETE",
      `/v1/orgs/${encodeURIComponent(orgId)}/me/athletes/${encodeURIComponent(athleteId)}`,
    );
  }
  /** Deletes a training session with its reports (coaches for their teams). */
  deleteTrainingSession(orgId: string, sessionId: string) {
    return this.request<{ ok: true }>("DELETE", `/v1/orgs/${encodeURIComponent(orgId)}/training/sessions/${encodeURIComponent(sessionId)}`);
  }
}
