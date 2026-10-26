/**
 * In-memory pod that implements the configuration API (docs/firmware/config-api.md) like the firmware
 * (src/Config/ConfigApi.cpp, src/Store/ProgramStore.cpp). Used for development, unit tests and
 * demos without hardware. Radio, sync and games are not simulated.
 */
import { BLOCK_TYPES } from "@reactpod/program-model";
import { INDEX_PATH, isValidPath, MAX_FILE_SIZE, MAX_GET_CHUNK, MAX_PATH, MAX_REQUEST, MAX_SET_NAME, PROGRAM_FORMAT } from "@reactpod/program-model";
import { validateProgram, type Issue } from "@reactpod/program-model";
import { crc32, crcHex, hex32 } from "../crc32";
import type { ApiErrorCode, PodRole } from "../protocol";
import { byteLength, encodeUtf8 } from "../utf8";

const BAD_PATH_MESSAGE = `path must be /programs.json or /prog/... (max ${MAX_PATH} characters)`;

export type SimulatedPodOptions = {
  files?: Record<string, string>;
  role?: PodRole;
  setId?: string;
  generation?: number;
  firmware?: string;
  blockTypes?: string[];
  freeBytes?: number;
  setName?: string;
  /** a PIN makes put / delete / setName need `auth` (like BLE, firmware ≥ 2.6) */
  pin?: string;
  /**
   * Demo of the planned reports and remote control (#41, #42; not in the firmware yet): adds the
   * features "reports" and "remote", the ops `reports`, `ack`, `session`, `command` and
   * `emitSampleReport()`. Off by default, so the simulated pod behaves like today's firmware.
   */
  results?: boolean;
  /**
   * `info.programFormat` (programs.md §6), default PROGRAM_FORMAT. A lower value simulates an older
   * central: its default `blockTypes` leave out newer types (format 1: no `repeat`), `firmware`
   * defaults to "2.7" (format 2: "2.8", format 3: "2.9"), and `status` has no `timers`.
   */
  programFormat?: number;
};

/** Reports the central keeps until they are acknowledged (#41). */
const REPORT_BUFFER = 8;

type Json = Record<string, unknown>;

class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class SimulatedPod {
  readonly files = new Map<string, string>();
  role: PodRole;
  /** "MENU" allows store changes; anything else (e.g. "RUN") answers `busy` like during a game */
  state = "MENU";
  readonly setId: string;
  generation: number;
  firmware: string;
  readonly programFormat: number;
  blockTypes: string[];
  /** `status.timers.orphanStops` while a game runs (RUN / PAUSED, programs.md §7.9); set by tests and demos */
  orphanStops = 0;
  freeBytes: number;
  setName: string;
  pin: string;
  /** answers the next n requests with `overflow`, like a BLE receive buffer overrun */
  overflowNext = 0;

  /** demo results (#41 / #42), see SimulatedPodOptions.results */
  readonly results: boolean;
  /** athlete id from `session` ("" = none) */
  athlete = "";
  /** a communicate block waits for `command` (after a sample report) */
  waiting = false;
  /** reports not acknowledged yet, oldest first */
  readonly pendingReports: Json[] = [];
  droppedReports = 0;
  /** receives event lines (without "\n"); set by the transport */
  onEvent: ((line: string) => void) | null = null;

  private upload: { path: string; data: string; bytes: number } | null = null;
  private authenticated = false;
  private nextReportId = 1;
  private cycle = 0;
  private readonly bootAt = Date.now();

  constructor(options: SimulatedPodOptions = {}) {
    for (const [path, text] of Object.entries(options.files ?? {})) this.files.set(path, text);
    this.role = options.role ?? "central";
    this.setId = options.setId ?? "5f3a91c2";
    this.generation = options.generation ?? 1;
    this.programFormat = options.programFormat ?? PROGRAM_FORMAT;
    this.firmware = options.firmware ?? (this.programFormat >= 3 ? "2.9" : this.programFormat >= 2 ? "2.8" : "2.7");
    this.blockTypes = options.blockTypes ?? BLOCK_TYPES.filter((t) => (t.minFormat ?? 1) <= this.programFormat).map((t) => t.type);
    this.freeBytes = options.freeBytes ?? 1_800_000;
    this.setName = options.setName ?? "";
    this.pin = options.pin ?? "";
    this.results = options.results ?? false;
  }

  /** A new client connected: it has to authenticate again, an unfinished upload is dropped. */
  newSession() {
    this.authenticated = false;
    this.upload = null;
  }

  /** Handles one request line, returns the response line (without "\n"). */
  handle(line: string): string {
    if (this.overflowNext > 0) {
      this.overflowNext--;
      return JSON.stringify({ ok: false, error: "overflow", message: "request data arrived faster than it could be processed" });
    }
    if (byteLength(line) > MAX_REQUEST) {
      return JSON.stringify({ ok: false, error: "too_large", message: `request larger than ${MAX_REQUEST} bytes` });
    }
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "bad_request", message: `invalid JSON: ${String(e)}` });
    }
    if (typeof request !== "object" || request === null || Array.isArray(request)) {
      return JSON.stringify({ ok: false, error: "bad_request", message: "invalid JSON: not an object" });
    }
    const req = request as Json;
    const op = typeof req.op === "string" ? req.op : "";
    const response: Json = { op };
    if (req.id !== undefined && req.id !== null) response.id = req.id;
    try {
      Object.assign(response, { ok: true }, this.dispatch(op, req));
    } catch (e) {
      if (!(e instanceof ApiFailure)) throw e;
      Object.assign(response, { ok: false, error: e.code, message: e.message });
    }
    return JSON.stringify(response);
  }

  get storeHash(): string {
    return hex32(crc32(encodeUtf8(this.manifest())));
  }

  /** Same text the firmware hashes: "path\tsize\tcrc\n" per file, sorted by path. */
  manifest(): string {
    return this.fileList()
      .map((f) => `${f.path}\t${f.size}\t${f.crc}\n`)
      .join("");
  }

  fileList() {
    return [...this.files.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, text]) => ({ path, size: byteLength(text), crc: crcHex(text) }));
  }

  private dispatch(op: string, req: Json): Json {
    switch (op) {
      case "help":
        return {
          ops: ["help", "status", "info", "list", "get", "put", "delete", "validate", "setName", "auth", ...(this.results ? ["reports", "ack", "session", "command"] : [])],
          transport: "simulated",
        };
      case "info":
        return this.info();
      case "status":
        return this.status();
      case "list":
        return this.list();
      case "get":
        return this.get(req);
      case "put":
        return this.put(req);
      case "delete":
        return this.remove(req);
      case "validate":
        return this.validate(req);
      case "auth":
        return this.auth(req);
      case "setName":
        return this.storeSetName(req);
      case "setPin":
        throw new ApiFailure("bad_request", "the PIN can only be set or cleared over USB serial");
      case "reports":
      case "ack":
      case "session":
      case "command":
        if (this.results) return this.resultOp(op, req);
        throw new ApiFailure("bad_request", `unknown op '${op}' (try 'help')`);
      default:
        throw new ApiFailure("bad_request", `unknown op '${op}' (try 'help')`);
    }
  }

  private info(): Json {
    return {
      firmware: this.firmware,
      linkProtocol: 1,
      // firmware >= 2.9: hold reporting (link protocol revision 2, config-api.md)
      ...(this.programFormat >= 3 ? { linkRevision: 2 } : {}),
      setId: this.setId,
      setName: this.setName,
      pinRequired: this.pin !== "",
      generation: this.generation,
      storeHash: this.storeHash,
      freeBytes: this.freeBytes,
      maxFileSize: MAX_FILE_SIZE,
      maxPathLength: MAX_PATH,
      maxRequest: MAX_REQUEST,
      maxGetChunk: MAX_GET_CHUNK,
      transport: "simulated",
      programFormat: this.programFormat,
      features: [
        "validateInline",
        "listMeta",
        ...(this.programFormat >= 3 ? ["hold"] : []),
        ...(this.results ? ["reports", "remote"] : []),
      ],
      blockTypes: this.blockTypes,
    };
  }

  private status(): Json {
    return {
      role: this.role,
      state: this.state,
      firmware: this.firmware,
      uptimeMs: 1000,
      setId: this.setId,
      store: { generation: this.generation, hash: this.storeHash },
      // central in a game, firmware ≥ 2.8 (config-api.md §5)
      ...(this.role === "central" && (this.state === "RUN" || this.state === "PAUSED") && this.programFormat >= 2
        ? { timers: { orphanStops: this.orphanStops } }
        : {}),
      ...(this.results ? { athlete: this.athlete, reports: { pending: this.pendingReports.length, dropped: this.droppedReports } } : {}),
    };
  }

  private resultOp(op: string, req: Json): Json {
    switch (op) {
      case "reports":
        return { reports: this.pendingReports.map((r) => structuredClone(r)) };
      case "ack": {
        // `reportId`, not `id`: `id` is the request id that every response echoes (config-api §3)
        const reportId = req.reportId;
        if (typeof reportId !== "number") throw new ApiFailure("bad_request", "'reportId' (number) missing");
        // removes this report and the older ones
        while (this.pendingReports.length > 0 && (this.pendingReports[0]!.id as number) <= reportId) this.pendingReports.shift();
        return {};
      }
      case "session": {
        if (typeof req.athlete !== "string" || byteLength(req.athlete) > 40) {
          throw new ApiFailure("bad_request", "'athlete' must be a string of at most 40 bytes");
        }
        if (this.state !== "MENU" && !this.waiting) {
          throw new ApiFailure("busy", "the athlete can change in the menu or while a communicate block waits");
        }
        this.athlete = req.athlete;
        return { athlete: this.athlete };
      }
      default: {
        if (!["continue", "repeat", "stop"].includes(String(req.name))) {
          throw new ApiFailure("bad_request", "'name' must be continue, repeat or stop");
        }
        if (!this.waiting) throw new ApiFailure("not_ready", "no communicate block is waiting");
        this.waiting = false;
        return {};
      }
    }
  }

  /**
   * Demo: a `communicate` block was reached. Builds a report with random reaction times for the
   * first menu program, keeps it until `ack`, sends it as an event and waits for `command`.
   */
  emitSampleReport(random: () => number = Math.random): Json {
    if (!this.results) throw new Error("the results demo is off");
    let program = "/prog/solo.json";
    try {
      const index = JSON.parse(this.files.get(INDEX_PATH) ?? "") as Json;
      if (Array.isArray(index.programs) && typeof index.programs[0] === "string") program = index.programs[0];
    } catch {
      // keep the default
    }
    const count = 5 + Math.floor(random() * 4);
    const startMs = Math.max(0, Date.now() - this.bootAt);
    let t = startMs;
    const values: Json[] = [];
    for (let i = 0; i < count; i++) {
      t += 900 + Math.floor(random() * 600);
      values.push({ t, metric: "reaction", pod: 1 + Math.floor(random() * 3), ms: 240 + Math.floor(random() * 220) });
    }
    const endMs = t + 120;
    values.push({ t: endMs, metric: "lap", pod: 0, ms: endMs - startMs });
    const reaction = values.filter((v) => v.metric === "reaction").map((v) => v.ms as number);
    this.cycle++;
    const report: Json = {
      event: "report",
      id: this.nextReportId++,
      program,
      setId: this.setId,
      ...(this.athlete ? { athlete: this.athlete } : {}),
      cycle: this.cycle,
      startMs,
      endMs,
      values,
      stats: {
        reaction: {
          count: reaction.length,
          average: Math.round(reaction.reduce((a, b) => a + b, 0) / reaction.length),
          best: Math.min(...reaction),
          worst: Math.max(...reaction),
        },
      },
      vars: { RUNS: count, MAX_LOOPS: 12 },
    };
    this.pendingReports.push(report);
    if (this.pendingReports.length > REPORT_BUFFER) {
      this.pendingReports.shift();
      this.droppedReports++;
    }
    this.waiting = true;
    this.onEvent?.(JSON.stringify(report));
    return report;
  }

  private list(): Json {
    let menu: unknown[] = [];
    try {
      const index = JSON.parse(this.files.get(INDEX_PATH) ?? "") as Json;
      if (Array.isArray(index.programs)) menu = index.programs;
    } catch {
      // no or broken index: empty menu, like the firmware
    }
    const files = this.fileList().map((entry) => (entry.path === INDEX_PATH ? entry : { ...entry, ...this.meta(entry.path) }));
    return { generation: this.generation, storeHash: this.storeHash, files, menu };
  }

  /** Program metadata in `list` (listMeta), like ProgramStore::programMeta. */
  private meta(path: string): Json {
    let doc: unknown;
    try {
      doc = JSON.parse(this.files.get(path)!);
    } catch {
      return {};
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return {};
    const d = doc as Json;
    if (typeof d.name !== "string") return { fragment: true };
    const meta: Json = { name: d.name };
    if (d.peripherals !== undefined && d.peripherals !== null) meta.peripherals = d.peripherals;
    if (d.menu !== undefined && d.menu !== null) meta.menu = d.menu;
    return meta;
  }

  private requireWriteAccess() {
    if (this.pin !== "" && !this.authenticated) {
      throw new ApiFailure("auth_required", 'a PIN is set: send {"op":"auth","pin":"..."} first');
    }
  }

  private auth(req: Json): Json {
    if (this.pin !== "" && req.pin !== this.pin) {
      this.authenticated = false;
      throw new ApiFailure("auth_failed", "wrong PIN");
    }
    this.authenticated = true;
    return {};
  }

  private storeSetName(req: Json): Json {
    this.requireWriteAccess();
    if (req.name !== undefined && req.name !== null && typeof req.name !== "string") {
      throw new ApiFailure("bad_request", "'name' must be a string");
    }
    const name = (typeof req.name === "string" ? req.name : "").trim();
    if (byteLength(name) > MAX_SET_NAME) throw new ApiFailure("bad_request", `name longer than ${MAX_SET_NAME} bytes`);
    if (hasControlCharacter(name)) throw new ApiFailure("bad_request", "name contains control characters");
    this.setName = name;
    return { setName: name };
  }

  private requirePath(req: Json): string {
    if (!isValidPath(req.path)) throw new ApiFailure("bad_path", BAD_PATH_MESSAGE);
    return req.path;
  }

  private requireEditable() {
    if (this.state !== "MENU") {
      throw new ApiFailure("busy", "program files cannot be changed now (game or sync running)");
    }
  }

  private get(req: Json): Json {
    const path = this.requirePath(req);
    const offset = typeof req.offset === "number" ? req.offset : 0;
    let length = typeof req.length === "number" ? req.length : 2048;
    if (length <= 0 || length > MAX_GET_CHUNK) length = MAX_GET_CHUNK;

    const text = this.files.get(path);
    if (text === undefined) throw new ApiFailure("not_found", `${path} does not exist`);
    const bytes = encodeUtf8(text);
    if (offset > bytes.length || (offset === bytes.length && bytes.length > 0)) {
      throw new ApiFailure("bad_offset", "offset beyond end of file");
    }
    let n = Math.min(length, bytes.length - offset);
    // never split a UTF-8 character between two chunks
    if (offset + n < bytes.length) {
      while (n > 0 && (bytes[offset + n]! & 0xc0) === 0x80) n--;
    }
    const data = new TextDecoder().decode(bytes.subarray(offset, offset + n));
    return { path, offset, size: bytes.length, crc: crcHex(text), eof: offset + n >= bytes.length, data };
  }

  private put(req: Json): Json {
    this.requireWriteAccess();
    if (this.role === "booting") throw new ApiFailure("busy", "pod is starting");
    this.requireEditable();
    const path = this.requirePath(req);
    if (typeof req.data !== "string") throw new ApiFailure("bad_request", "'data' (string) missing");
    const data = req.data;
    const len = byteLength(data);
    const offset = typeof req.offset === "number" ? req.offset : 0;
    const final = typeof req.final === "boolean" ? req.final : true;

    if (offset === 0) {
      this.upload = { path, data: "", bytes: 0 };
    } else if (!this.upload || this.upload.path !== path || offset !== this.upload.bytes) {
      const expected = this.upload ? `${this.upload.bytes} for ${this.upload.path}` : "0";
      throw new ApiFailure("bad_offset", `expected offset ${expected}`);
    }
    const upload = this.upload!;
    if (offset + len > MAX_FILE_SIZE) {
      this.upload = null;
      throw new ApiFailure("too_large", `file larger than ${MAX_FILE_SIZE} bytes`);
    }
    upload.data += data;
    upload.bytes += len;

    if (!final) return { path, received: upload.bytes };

    this.upload = null;
    const crc = crcHex(upload.data);
    if (req.crc !== undefined && req.crc !== null && String(req.crc).toLowerCase() !== crc) {
      throw new ApiFailure("crc_mismatch", `received data has CRC ${crc}`);
    }
    try {
      JSON.parse(upload.data);
    } catch (e) {
      throw new ApiFailure("invalid_json", e instanceof Error ? e.message : String(e));
    }
    this.files.set(path, upload.data);
    this.generation++;
    return { path, size: upload.bytes, crc, generation: this.generation };
  }

  private remove(req: Json): Json {
    this.requireWriteAccess();
    this.requireEditable();
    const path = this.requirePath(req);
    if (!this.files.delete(path)) throw new ApiFailure("not_found", `${path} does not exist`);
    this.generation++;
    return { path, generation: this.generation };
  }

  private validate(req: Json): Json {
    if (this.state !== "MENU") {
      throw new ApiFailure("busy", "a program is selected or running; validate in the program menu");
    }
    const path = req.path;
    const data = req.data;
    if (data !== undefined && data !== null) {
      // dry run (validateInline): the program text comes with the request, nothing is stored
      if (typeof data !== "string") throw new ApiFailure("bad_request", "'data' must be a string");
      if (!isValidPath(path)) throw new ApiFailure("bad_path", BAD_PATH_MESSAGE);
    } else if (!isValidPath(path) || !this.files.has(path)) {
      throw new ApiFailure("not_found", "program file not found");
    }
    const source = (p: string) => (p === path && typeof data === "string" ? data : this.files.get(p));
    const resolved = validateProgram(path, source, { supportedTypes: this.blockTypes, programFormat: this.programFormat });
    const error = resolved.issues.find((issue) => issue.severity === "error");
    if (error) throw new ApiFailure("invalid_program", describe(error));
    return { path, blocks: resolved.blocks.length };
  }
}

function hasControlCharacter(text: string): boolean {
  for (const c of text) {
    const code = c.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Roughly the firmware's loader message, e.g. "/prog/x.json: block 'Hit': unknownType type=buton". */
function describe(issue: Issue): string {
  const where = issue.block ? `${issue.file}: block '${issue.block}'` : issue.file;
  const params = Object.entries(issue.params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${where}: ${issue.code}${params ? ` ${params}` : ""}`;
}
