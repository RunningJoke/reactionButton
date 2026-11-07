/**
 * In-memory pod that implements the configuration API (docs/firmware/config-api.md) like the firmware
 * (src/Config/ConfigApi.cpp, src/Store/ProgramStore.cpp). Used for development, unit tests and
 * demos without hardware. Radio, sync and games are not simulated.
 */
import { BLOCK_TYPES } from "@reactpod/program-model";
import { INDEX_PATH, isValidPath, MAX_FILE_SIZE, MAX_GET_CHUNK, MAX_PATH, MAX_REQUEST, MAX_SET_NAME, PROGRAM_FORMAT } from "@reactpod/program-model";
import { validateProgram, type Issue } from "@reactpod/program-model";
import { crc32, crcHex, hex32 } from "../crc32";
import type { ApiErrorCode, OtaStatus, PodRole } from "../protocol";
import { batteryPercent } from "../battery";
import { byteLength, encodeUtf8 } from "../utf8";
import { Sha256 } from "./sha256";

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
   * `info.programFormat` (programs.md §6), default PROGRAM_FORMAT. A lower value simulates an older
   * central: its default `blockTypes` leave out newer types (format 1: no `repeat`), `firmware`
   * defaults to "2.7" (format 2: "2.8", format 3: "2.9", format 4: "2.10", format 5: "2.12", the newest firmware with pause and liveBle; format 6: "2.19", the summary bar, identify and battery (2.13), auto power-off, the system patterns (2.15), start variables (2.17) and the firmware update (2.19)), and
   * `status` has no `timers`. Format 5 adds the reports and the remote ops (`reports`, `ack`,
   * `command`, `setVariables`, `session`, `pause`, `resume`); `emitSampleReport()` makes a demo report.
   */
  programFormat?: number;
  /**
   * Number of connected peripherals: central `status` then lists `pods[]` (config-api.md §5) with the
   * link features of the pods' firmware (`effects`, `hold` from format 3, `toggle` from format 4).
   * Default: no `pods` in `status`.
   */
  pods?: number;
  /**
   * BLE stays on during the game (firmware ≥ 2.12, `liveBle`, config-api.md §1). Default: on with
   * format 5. Adds the feature `liveBle` and `ble` in the central `status`.
   */
  liveBle?: boolean;
  /**
   * Battery reports (firmware ≥ 2.13, feature `battery`): `battery` in the status of the pod and of each
   * `pods[]` entry, with demo cell voltages. `false` simulates older firmware (no field, no feature).
   * Default: on with program format 5 (firmware 2.13).
   */
  battery?: boolean;
  /**
   * Clock in ms for the time-based parts (the firmware update's 15 s trial and idle timeout). Default
   * `Date.now`; tests pass their own.
   */
  clock?: () => number;
};

/** Firmware update (firmware ≥ 2.19, config-api.md "Firmware update"): slot size, chunk size, trial, idle timeout. */
const OTA_SLOT_SIZE = 1835008;
const OTA_MAX_CHUNK = 3072;
const OTA_TRIAL_MS = 15000;
const OTA_IDLE_MS = 10 * 60 * 1000;
const OTA_MIN_BATTERY_PERCENT = 30;
const OTA_VERSION_MAX = 31;
const OTA_IMAGE_MAGIC = 0xe9;
const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

type OtaUpdate = { state: OtaStatus["state"]; received: number; total: number; version: string; sha: string; hash: Sha256; lastMs: number };
const freshUpdate = (): OtaUpdate => ({ state: "idle", received: 0, total: 0, version: "", sha: "", hash: new Sha256(), lastMs: 0 });

/** Base64 of the image chunk; null when it is not valid base64 (strict, padded, like mbedtls). */
function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** Reports the central keeps until they are acknowledged (#41). */
const REPORT_BUFFER = 8;

/** The demo program's editable variables (its communicate block, and the start card in CONFIRM). */
const START_EDITABLE = { MAX_LOOPS: { min: 1, max: 50 } };

type Json = Record<string, unknown>;

/** Identity colours of pods 1 … 7 (firmware LEDManager/Identity.h, 2.15): blue, cyan, violet, magenta, yellow, orange, cream. */
const IDENTITY_COLORS = ["#0000ff", "#00ffff", "#a064ff", "#ff00ff", "#ffff00", "#ff7800", "#ffebc8"];

/** System patterns of the `pattern` op (firmware ≥ 2.15) and their duration in ms; 0 = endless (until the next op). */
const PATTERN_DURATIONS: Record<string, number> = {
  boot: 2600,
  search: 0,
  joined: 0,
  discovery: 0,
  ready: 0,
  select: 1600,
  selectCancel: 0, // = fillMs, see pattern()
  selected: 700,
  paused: 0,
  lowBattery: 0,
  sleep: 2000,
  menu: 0,
  update: 0,
  updateVerify: 0,
  updateReady: 0,
  updateFailed: 6000,
};

class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    /** more response fields, e.g. `received` of bad_offset */
    readonly extra: Json = {},
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
  readonly podCount: number | undefined;
  private readonly liveBleOption: boolean | undefined;
  private readonly batteryOption: boolean;
  blockTypes: string[];
  /** `status.timers.orphanStops` while a game runs (RUN / PAUSED, programs.md §7.9); set by tests and demos */
  orphanStops = 0;
  freeBytes: number;
  setName: string;
  pin: string;
  /** answers the next n requests with `overflow`, like a BLE receive buffer overrun */
  overflowNext = 0;

  /** athlete id from `session` ("" = none) */
  athlete = "";
  /** PAUSED by `pause` (firmware ≥ 2.12): only `resume` ends it; a lost peripheral does not, here */
  phonePaused = false;
  /** the communicate block that waits (programs.md §7.16), or null; set by `emitSampleReport()` */
  waiting: { block: string; editable: Record<string, { min: number; max: number }> } | null = null;
  /** variables of the demo program (RUNS, MAX_LOOPS); `setVariables` changes the editable ones */
  readonly variables = new Map<string, number>([
    ["RUNS", 0],
    ["MAX_LOOPS", 12],
  ]);
  /** reports not acknowledged yet, oldest first */
  readonly pendingReports: Json[] = [];
  droppedReports = 0;
  /** receives event lines (without "\n"); set by the transport */
  onEvent: ((line: string) => void) | null = null;

  private upload: { path: string; data: string; bytes: number } | null = null;
  private authenticated = false;
  private nextReportId = 1;
  private cycle = 0;
  private readonly bootAt: number;
  private readonly clock: () => number;

  /** central's cell voltage in mV (3.95 V = 60 %); below 30 % `otaBegin` answers low_battery */
  selfBatteryMv = 3950;
  /** firmware update (firmware ≥ 2.19): the update in progress */
  private ota: OtaUpdate = freshUpdate();
  private running: "app0" | "app1" = "app0";
  private lastResult: "none" | "ok" | "rolledBack" = "none";
  /** the image activated by otaActivate is on trial until `startMs` + 15 s; `previous` is what a rollback returns to */
  private trial: { startMs: number; fails: boolean; previous: { firmware: string; running: "app0" | "app1" } } | null = null;
  /** test hook: the next otaActivate's image fails its self-test in the trial and is rolled back */
  otaSelfTestFails = false;
  /** test hook: the next otaEnd fails the image check (esp_ota_end), as for a corrupt image */
  otaFailNextVerify = false;
  /** a reboot happened (otaActivate, rollback): the transport drops the connection after the answer */
  private restart = false;

  constructor(options: SimulatedPodOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.bootAt = this.clock();
    for (const [path, text] of Object.entries(options.files ?? {})) this.files.set(path, text);
    this.role = options.role ?? "central";
    this.setId = options.setId ?? "5f3a91c2";
    this.generation = options.generation ?? 1;
    this.programFormat = options.programFormat ?? PROGRAM_FORMAT;
    this.podCount = options.pods;
    this.liveBleOption = options.liveBle;
    this.batteryOption = options.battery ?? this.programFormat >= 6;
    this.firmware =
      options.firmware ??
      (this.programFormat >= 6 ? "2.19" : this.programFormat >= 5 ? "2.12" : this.programFormat >= 4 ? "2.10" : this.programFormat >= 3 ? "2.9" : this.programFormat >= 2 ? "2.8" : "2.7");
    this.blockTypes = options.blockTypes ?? BLOCK_TYPES.filter((t) => (t.minFormat ?? 1) <= this.programFormat).map((t) => t.type);
    this.freeBytes = options.freeBytes ?? 1_800_000;
    this.setName = options.setName ?? "";
    this.pin = options.pin ?? "";
  }

  /** firmware ≥ 2.13: identity (number, colour, blink), feature `identify`, link revision 4 */
  private get identifies(): boolean {
    return Number(this.firmware.split(".")[1]) >= 13;
  }

  /** firmware ≥ 2.15: system patterns (op `pattern`), feature `patterns`, link revision 5 */
  private get patterns(): boolean {
    return Number(this.firmware.split(".")[1]) >= 15;
  }

  /** firmware ≥ 2.17: `setVariables` in CONFIRM, `status.ready.editable`, feature `startVars` (config-api.md §3) */
  get startVars(): boolean {
    return this.remote && Number(this.firmware.split(".")[1]) >= 17;
  }

  /** firmware ≥ 2.11 (program format 5): the reports and the remote ops, features `reports` and `remote` */
  get remote(): boolean {
    return this.programFormat >= 5;
  }

  /** firmware ≥ 2.13: battery levels, feature `battery` */
  get battery(): boolean {
    return this.batteryOption;
  }

  /** Demo cell voltage (mV) of the pod with this id; the central ("self") is at 3.95 V. */
  private batteryMv(id: number | "self"): number {
    if (id === "self") return this.selfBatteryMv;
    const demo = [4080, 3760, 3640, 4150, 3900, 3700, 4010];
    return demo[id % demo.length]!;
  }

  private batteryLevel(id: number | "self"): Json {
    const mv = this.batteryMv(id);
    return { percent: batteryPercent(mv), mv };
  }

  /** firmware ≥ 2.12: BLE stays connected during the game, feature `liveBle` */
  get liveBle(): boolean {
    return this.liveBleOption ?? this.remote;
  }

  /** firmware ≥ 2.19: firmware update over the config API, feature `ota`, `info.ota`, `status.ota` */
  get otaEnabled(): boolean {
    return Number(this.firmware.split(".")[1]) >= 19;
  }

  /** A new client connected: it has to authenticate again, an unfinished upload is dropped. */
  newSession() {
    this.authenticated = false;
    this.upload = null;
  }

  /** True once after a reboot (otaActivate, rollback): the transport then drops the connection, like the pod does. */
  takeRestart(): boolean {
    const restart = this.restart;
    this.restart = false;
    return restart;
  }

  /** Handles one request line, returns the response line (without "\n"). */
  handle(line: string): string {
    if (this.overflowNext > 0) {
      this.overflowNext--;
      return JSON.stringify({ ok: false, error: "overflow", message: "request data arrived faster than it could be processed" });
    }
    this.settleOta();
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
      Object.assign(response, { ok: false, error: e.code, message: e.message }, e.extra);
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
          ops: [
            "help",
            "status",
            "info",
            "list",
            "get",
            "put",
            "delete",
            "validate",
            "setName",
            "auth",
            ...(this.remote ? ["reports", "ack", "session", "command", "setVariables", "pause", "resume", "start"] : []),
            ...(this.role === "central" && this.identifies ? ["blink"] : []),
            ...(this.role === "central" && this.patterns ? ["pattern"] : []),
            ...(this.otaEnabled ? ["otaBegin", "otaWrite", "otaEnd", "otaActivate", "otaAbort"] : []),
          ],
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
      case "blink":
        return this.blink(req);
      case "pattern":
        return this.pattern(req);
      case "setPin":
        throw new ApiFailure("bad_request", "the PIN can only be set or cleared over USB serial");
      case "reports":
      case "ack":
      case "session":
      case "command":
      case "setVariables":
      case "pause":
      case "resume":
        if (this.remote) return this.remoteOp(op, req);
        throw new ApiFailure("bad_request", `unknown op '${op}' (try 'help')`);
      case "start":
        return this.start();
      case "otaBegin":
      case "otaWrite":
      case "otaEnd":
      case "otaActivate":
      case "otaAbort":
        if (this.otaEnabled) return this.firmwareUpdate(op, req);
        throw new ApiFailure("bad_request", `unknown op '${op}' (try 'help')`);
      default:
        throw new ApiFailure("bad_request", `unknown op '${op}' (try 'help')`);
    }
  }

  private info(): Json {
    return {
      firmware: this.firmware,
      linkProtocol: 1,
      // firmware >= 2.9: hold reporting (link protocol revision 2), >= 2.10: toggle (revision 3), config-api.md
      ...(this.programFormat >= 3 ? { linkRevision: this.patterns ? 5 : this.identifies || this.battery ? 4 : this.programFormat >= 4 ? 3 : 2 } : {}),
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
        ...(this.programFormat >= 2 ? ["effects"] : []),
        ...(this.programFormat >= 3 ? ["hold"] : []),
        ...(this.programFormat >= 4 ? ["toggle"] : []),
        ...(this.remote ? ["reports", "remote", "pause"] : []),
        ...(this.liveBle ? ["liveBle"] : []),
        ...(this.identifies ? ["identify"] : []),
        ...(this.battery ? ["battery"] : []),
        ...(this.patterns ? ["patterns"] : []),
        ...(this.startVars ? ["startVars"] : []),
        ...(this.otaEnabled ? ["ota"] : []),
      ],
      blockTypes: this.blockTypes,
      ...(this.otaEnabled
        ? { ota: { slotSize: OTA_SLOT_SIZE, running: this.running, lastResult: this.lastResult } }
        : {}),
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
      // firmware ≥ 2.12 (config-api.md §5); the demo has no real heap
      heap: { free: 120_000, minFree: 90_000 },
      ...(this.role === "central" && this.liveBle
        ? { ble: { connected: true, intervalMs: this.state === "MENU" ? 0 : 100 } }
        : {}),
      // firmware >= 2.13: the battery of this pod (config-api.md §5)
      ...(this.battery ? { battery: this.batteryLevel("self") } : {}),
      ...(this.otaEnabled
        ? { ota: { state: this.ota.state, received: this.ota.received, total: this.ota.total, version: this.ota.version } }
        : {}),
      // central in a game, firmware ≥ 2.8 (config-api.md §5)
      ...(this.role === "central" && (this.state === "RUN" || this.state === "PAUSED") && this.programFormat >= 2
        ? { timers: { orphanStops: this.orphanStops } }
        : {}),
      ...(this.role === "central" && this.podCount !== undefined
        ? {
            pods: Array.from({ length: this.podCount }, (_, id) => ({
              id,
              mac: `24:6f:28:00:00:${id.toString(16).padStart(2, "0")}`,
              alive: true,
              lastSeenMs: 40,
              effects: this.programFormat >= 2,
              ...(this.programFormat >= 3 ? { hold: true } : {}),
              ...(this.programFormat >= 4 ? { toggle: true } : {}),
              ...(this.identifies ? { number: id + 1, color: IDENTITY_COLORS[id % IDENTITY_COLORS.length] } : {}),
              ...(this.battery ? { battery: this.batteryLevel(id) } : {}),
            })),
          }
        : {}),
      ...(this.remote
        ? {
            athlete: this.athlete,
            phonePaused: this.phonePaused,
            reports: { pending: this.pendingReports.length, dropped: this.droppedReports },
            ...(this.isWaiting() ? { waiting: { block: this.waiting!.block, editable: this.editableView() } } : {}),
            ...(this.startVars && this.state === "CONFIRM" ? { ready: { editable: this.editableView(START_EDITABLE) } } : {}),
          }
        : {}),
    };
  }

  /** A communicate block waits; not while PAUSED (programs.md §7.16). */
  private isWaiting(): boolean {
    return this.waiting !== null && this.state !== "PAUSED";
  }

  /** `editable` of the waiting block with the current values (config-api.md §5, status.waiting). */
  private editableView(editable: Record<string, { min: number; max: number }> = this.waiting?.editable ?? {}): Record<string, { min: number; max: number; value: number }> {
    return Object.fromEntries(Object.entries(editable).map(([name, range]) => [name, { ...range, value: this.variables.get(name) ?? 0 }]));
  }

  /** CONFIRM (firmware ≥ 2.17): `start` runs the first cycle with the values set so far (config-api.md §5). */
  private start(): Json {
    if (this.state !== "CONFIRM") throw new ApiFailure("not_ready", `state is ${this.state}, not CONFIRM`);
    this.state = "RUN";
    return { state: this.state };
  }

  /** What the pod does on its own clock, before each request: the verdict on a trial image, the idle timeout of an update. */
  private settleOta() {
    const now = this.clock();
    if (this.trial && now - this.trial.startMs >= OTA_TRIAL_MS) {
      const { fails, previous } = this.trial;
      this.trial = null;
      if (fails) {
        // the bootloader returns to the old image; the pod restarts
        this.firmware = previous.firmware;
        this.running = previous.running;
        this.lastResult = "rolledBack";
        this.restart = true;
      } else {
        this.lastResult = "ok";
      }
    }
    if ((this.ota.state === "receiving" || this.ota.state === "ready") && now - this.ota.lastMs >= OTA_IDLE_MS) {
      this.ota = freshUpdate();
    }
  }

  /** firmware ≥ 2.19 (config-api.md "Firmware update"): the five ops; a PIN needs `auth` for all of them, as for put. */
  private firmwareUpdate(op: string, req: Json): Json {
    this.requireWriteAccess();
    switch (op) {
      case "otaBegin":
        return this.otaBegin(req);
      case "otaWrite":
        return this.otaWrite(req);
      case "otaEnd":
        return this.otaEnd();
      case "otaActivate":
        return this.otaActivate();
      default:
        this.ota = freshUpdate();
        return {};
    }
  }

  private otaBegin(req: Json): Json {
    // firmware: only in the menu (central) or a peripheral not in a game
    if (this.state !== "MENU") throw new ApiFailure("busy", "a firmware update needs the menu (central) or a pod not in a game");
    const size = req.size;
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > 0xffffffff) {
      throw new ApiFailure("bad_request", "'size' (bytes of the image, > 0) missing");
    }
    if (typeof req.sha256 !== "string" || !SHA256_HEX.test(req.sha256)) {
      throw new ApiFailure("bad_request", "'sha256' (64 hex characters) missing");
    }
    const sha = req.sha256.toLowerCase();
    const version = req.version ?? "";
    if (typeof version !== "string" || byteLength(version) > OTA_VERSION_MAX) {
      throw new ApiFailure("bad_request", `'version' must be a string of at most ${OTA_VERSION_MAX} characters`);
    }
    // a pod with no battery reading is allowed (firmware batteryAllows)
    const percent = batteryPercent(this.selfBatteryMv);
    if (this.battery && percent < OTA_MIN_BATTERY_PERCENT) {
      throw new ApiFailure("low_battery", `battery at ${percent} %, an update needs ${OTA_MIN_BATTERY_PERCENT} %`);
    }
    if (this.trial) throw new ApiFailure("busy", "the running firmware is still being tested (15 s after an update), try again");
    if (size > OTA_SLOT_SIZE) throw new ApiFailure("too_large", `image larger than the slot (${OTA_SLOT_SIZE} bytes)`);

    const now = this.clock();
    const answer = { slotSize: OTA_SLOT_SIZE, maxChunk: OTA_MAX_CHUNK };
    const u = this.ota;
    // the same image while it is open (receiving or ready): continue there; a dropped connection does not end it
    if ((u.state === "receiving" || u.state === "ready") && u.total === size && u.sha === sha) {
      u.lastMs = now;
      return { ...answer, received: u.received };
    }
    this.lastResult = "none";
    this.ota = { ...freshUpdate(), state: "receiving", total: size, version, sha, lastMs: now };
    return { ...answer, received: 0 };
  }

  private otaWrite(req: Json): Json {
    const u = this.ota;
    if (u.state !== "receiving") throw new ApiFailure("not_ready", `no update is receiving (update state ${u.state}), send otaBegin first`);
    if (typeof req.offset !== "number" || !Number.isInteger(req.offset) || req.offset < 0 || typeof req.data !== "string") {
      throw new ApiFailure("bad_request", "'offset' (number) and 'data' (base64 string) needed");
    }
    // base64 of maxChunk bytes is at most 4096 characters
    if (req.data.length > (OTA_MAX_CHUNK / 3) * 4) {
      throw new ApiFailure("bad_request", `'data' longer than maxChunk (${OTA_MAX_CHUNK} bytes)`);
    }
    const bytes = decodeBase64(req.data);
    if (bytes === null || bytes.length > OTA_MAX_CHUNK) {
      throw new ApiFailure("bad_request", "'data' is not valid base64 or larger than maxChunk");
    }
    if (bytes.length === 0) throw new ApiFailure("bad_request", "'data' is empty");
    if (req.offset !== u.received) throw new ApiFailure("bad_offset", `expected offset ${u.received}`, { received: u.received });
    if (u.received + bytes.length > u.total) throw new ApiFailure("too_large", `data past the announced size ${u.total}`);
    if (u.received === 0 && bytes[0] !== OTA_IMAGE_MAGIC) {
      // esp_ota_write checks the image header of the first chunk; the update is over
      u.state = "failed";
      throw new ApiFailure("ota_failed", "the image does not start with the image header (0xE9)");
    }
    u.hash.update(bytes);
    u.received += bytes.length;
    u.lastMs = this.clock();
    return { received: u.received };
  }

  private otaEnd(): Json {
    const u = this.ota;
    if (u.state !== "receiving") throw new ApiFailure("not_ready", `no update is receiving (update state ${u.state})`);
    if (u.received !== u.total) throw new ApiFailure("not_ready", `received ${u.received} of ${u.total} bytes`);
    if (u.hash.hexDigest() !== u.sha) {
      u.state = "failed";
      throw new ApiFailure("ota_failed", "SHA-256 of the received image differs from 'sha256'");
    }
    if (this.otaFailNextVerify) {
      this.otaFailNextVerify = false;
      u.state = "failed";
      throw new ApiFailure("ota_failed", "image rejected by the image check (test hook otaFailNextVerify)");
    }
    u.state = "ready";
    u.lastMs = this.clock();
    return {};
  }

  /** The pod reboots into the new image: the update is gone, the image is on trial for 15 s (settleOta). */
  private otaActivate(): Json {
    if (this.ota.state !== "ready") throw new ApiFailure("not_ready", `no verified image, send otaEnd first (update state ${this.ota.state})`);
    this.trial = {
      startMs: this.clock(),
      fails: this.otaSelfTestFails,
      previous: { firmware: this.firmware, running: this.running },
    };
    this.otaSelfTestFails = false;
    // the demo has no real image: the update's version (if given) is the firmware it runs
    if (this.ota.version !== "") this.firmware = this.ota.version;
    this.running = this.running === "app0" ? "app1" : "app0";
    this.ota = freshUpdate();
    this.restart = true;
    return {};
  }

  /** firmware ≥ 2.13 (config-api.md §5): blinks a pod of the set, or the central ("pod" -1 or missing) for 2 s. */
  private blink(req: Json): Json {
    if (this.role !== "central" || !this.identifies) throw new ApiFailure("bad_request", "unknown op 'blink' (try 'help')");
    if (this.state !== "MENU" && this.state !== "DISCOVERY" && this.state !== "CONFIRM") {
      throw new ApiFailure("busy", `state is ${this.state}`);
    }
    const pod = req.pod === undefined ? -1 : req.pod;
    if (typeof pod !== "number" || !Number.isInteger(pod) || pod < -1 || pod >= (this.podCount ?? 0)) {
      throw new ApiFailure("bad_request", "'pod' must be a connected pod id or -1 (the central)");
    }
    if (pod >= 0 && this.programFormat < 2) throw new ApiFailure("not_ready", "pod has older firmware (no effects)");
    return { pod, durationMs: 2000 };
  }

  /**
   * firmware ≥ 2.15 (config-api.md §5, feature `patterns`): plays a system pattern on the pod itself
   * ("podId" -1 or missing = the central). Busy like `blink` and `effect`: only in the menu, discovery or confirm.
   */
  private pattern(req: Json): Json {
    if (this.role !== "central" || !this.patterns) throw new ApiFailure("bad_request", "unknown op 'pattern' (try 'help')");
    if (this.state !== "MENU" && this.state !== "DISCOVERY" && this.state !== "CONFIRM") {
      throw new ApiFailure("busy", `state is ${this.state}`);
    }
    const name = req.name;
    if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(PATTERN_DURATIONS, name)) {
      throw new ApiFailure("bad_request", `'name' must be one of ${Object.keys(PATTERN_DURATIONS).join(", ")}`);
    }
    for (const field of ["percent", "podId", "wanted", "found", "fillMs"] as const) {
      if (req[field] !== undefined && (typeof req[field] !== "number" || !Number.isInteger(req[field]))) {
        throw new ApiFailure("bad_request", `'${field}' must be an integer`);
      }
    }
    // podId is an argument of the pattern (whose light JOINED shows), not a target: the pod plays it itself
    for (const field of ["percent", "podId", "wanted", "found", "fillMs"] as const) {
      if (typeof req[field] === "number" && req[field] < 0) throw new ApiFailure("bad_request", `'${field}' must not be negative`);
    }
    const fillMs = typeof req.fillMs === "number" ? req.fillMs : 0;
    return { pattern: name, durationMs: name === "selectCancel" ? fillMs : PATTERN_DURATIONS[name]! };
  }

  private remoteOp(op: string, req: Json): Json {
    switch (op) {
      case "reports": {
        // the fields of the `report` event without `event` (config-api.md §5). Paging (firmware ≥ 2.12):
        // `from` (index into the unacknowledged reports, default 0) and `max` (default all)
        if ((req.from !== undefined && typeof req.from !== "number") || (req.max !== undefined && typeof req.max !== "number")) {
          throw new ApiFailure("bad_request", "'from' and 'max' must be numbers");
        }
        const total = this.pendingReports.length;
        const from = Math.min(Math.max(typeof req.from === "number" ? req.from : 0, 0), total);
        const count = Math.min(typeof req.max === "number" ? Math.max(req.max, 0) : total - from, total - from);
        const page = this.pendingReports.slice(from, from + count);
        return {
          reports: page.map(({ event: _event, ...report }) => structuredClone(report)),
          total,
          more: from + count < total,
        };
      }
      case "ack": {
        // `reportId`, not `id`: `id` is the request id that every response echoes (config-api §3)
        const reportId = req.reportId;
        if (typeof reportId !== "number") throw new ApiFailure("bad_request", "'reportId' (number) missing");
        // removes this report and the older ones
        while (this.pendingReports.length > 0 && (this.pendingReports[0]!.id as number) <= reportId) this.pendingReports.shift();
        return {};
      }
      case "pause": {
        // only in RUN; the same state as a lost peripheral (config-api.md §5)
        if (this.state !== "RUN") throw new ApiFailure("not_running", `state is ${this.state}, not RUN`);
        this.state = "PAUSED";
        this.phonePaused = true;
        return { state: this.state };
      }
      case "resume": {
        if (this.state !== "PAUSED" || !this.phonePaused) throw new ApiFailure("not_paused", "the game is not paused by the phone");
        // the demo pod has no peripheral loss, so the game always continues
        this.phonePaused = false;
        this.state = "RUN";
        return { state: this.state };
      }
      case "session": {
        if (typeof req.athlete !== "string" || byteLength(req.athlete) > 40) {
          throw new ApiFailure("bad_request", "'athlete' must be a string of at most 40 bytes");
        }
        if (!["MENU", "DISCOVERY", "CONFIRM"].includes(this.state) && !this.isWaiting()) {
          throw new ApiFailure("busy", "the athlete can change in the menu, before the start or while a communicate block waits");
        }
        this.athlete = req.athlete;
        return { athlete: this.athlete };
      }
      case "setVariables": {
        // all or nothing: every value is checked before one is written (config-api.md §5)
        if (typeof req.values !== "object" || req.values === null || Array.isArray(req.values)) {
          throw new ApiFailure("bad_request", "'values' must be an object of variable name → integer");
        }
        // in CONFIRM only with startVars (firmware ≥ 2.17): the values are used by the first cycle
        const inConfirm = this.state === "CONFIRM" && this.startVars;
        if (!this.isWaiting() && !inConfirm) throw new ApiFailure("not_ready", "no communicate block is waiting");
        const editable: Record<string, { min: number; max: number }> = inConfirm ? START_EDITABLE : this.waiting!.editable;
        const values = Object.entries(req.values as Json);
        for (const [name, value] of values) {
          // same order of checks as CentralRole::opSetVariables
          if (typeof value !== "number" || !Number.isInteger(value)) throw new ApiFailure("bad_request", `'${name}' must be an integer`);
          const range = editable[name];
          if (!range) throw new ApiFailure("not_editable", `'${name}' is not editable while the block waits`);
          if (value < range.min || value > range.max) {
            throw new ApiFailure("out_of_range", `'${name}' must be an integer from ${range.min} to ${range.max}`);
          }
        }
        for (const [name, value] of values) this.variables.set(name, value as number);
        return { variables: Object.fromEntries(values) };
      }
      default: {
        if (!["continue", "repeat", "stop"].includes(String(req.name))) {
          throw new ApiFailure("bad_request", "'name' must be continue, repeat or stop");
        }
        if (!this.isWaiting()) throw new ApiFailure("not_ready", "no communicate block is waiting");
        this.waiting = null;
        // `stop` ends the game (MENU); continue and repeat go on (RUN)
        if (req.name === "stop") this.state = "MENU";
        return {};
      }
    }
  }

  /** Demo: the program is ready to start (CONFIRM, the start card of the training view). Only from the menu. */
  emitReady(): Json {
    if (!this.startVars) throw new Error("start variables need firmware 2.17");
    if (this.state !== "MENU") throw new Error(`state is ${this.state}, not MENU`);
    this.state = "CONFIRM";
    return { state: this.state };
  }

  /**
   * Demo: a `communicate` block (block "Report", MAX_LOOPS editable 1 … 50) was reached. Builds a
   * report with random reaction times for the first menu program, keeps it until `ack`, sends it as
   * an event and waits for `command` / `setVariables`.
   */
  emitSampleReport(random: () => number = Math.random): Json {
    if (!this.remote) throw new Error("reports need program format 5 (firmware 2.11)");
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
    this.variables.set("RUNS", this.cycle);
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
      vars: Object.fromEntries(this.variables),
    };
    this.pendingReports.push(report);
    if (this.pendingReports.length > REPORT_BUFFER) {
      this.pendingReports.shift();
      this.droppedReports++;
    }
    // a game runs while the report waits (the training view shows RUN, #46)
    if (this.state === "MENU") this.state = "RUN";
    this.waiting = { block: "Report", editable: START_EDITABLE };
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
    this.requireEditable();
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

  /** store changes (put, delete, setName) only in the menu, and after an error (firmware: storeEditable) */
  private requireEditable() {
    if (this.state !== "MENU" && this.state !== "ERROR") {
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
