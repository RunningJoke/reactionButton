/** Messages of the configuration API (docs/firmware/config-api.md). */

/** Error codes the pod sends (§3.1 and control ops). */
export type ApiErrorCode =
  | "bad_request"
  | "bad_path"
  | "not_found"
  | "bad_offset"
  | "too_large"
  | "crc_mismatch"
  | "invalid_json"
  | "invalid_program"
  | "storage"
  | "overflow"
  | "busy"
  | "not_ready"
  | "not_editable" /** setVariables: the variable is not in the waiting block's `editable` (firmware ≥ 2.11) */
  | "out_of_range" /** setVariables: a value is not an integer within min … max (firmware ≥ 2.11) */
  | "not_running" /** pause: the game is not in RUN (firmware ≥ 2.12) */
  | "not_paused" /** resume: no phone pause is active (firmware ≥ 2.12) */
  | "auth_required" /** a PIN is set: put / delete / setName need `auth` first (firmware ≥ 2.6) */
  | "auth_failed" /** wrong PIN, or a retry within 3 s */
  | "low_battery"; /** start: the central or a pod is below 5 % (firmware ≥ 2.13, battery) */

/** Errors raised by the app itself while talking to a pod. */
export type ClientErrorCode =
  | "timeout" /** no response in time */
  | "disconnected" /** connection lost during the request */
  | "transfer_crc" /** downloaded data does not match the pod's CRC */
  | "protocol"; /** unexpected response */

export type PodErrorCode = ApiErrorCode | ClientErrorCode;

export class PodError extends Error {
  constructor(
    readonly code: PodErrorCode,
    message: string,
    readonly op?: string,
  ) {
    super(message);
    this.name = "PodError";
  }
}

export type ResponseBase = { op: string; id?: unknown; ok: boolean };
export type ErrorResponse = ResponseBase & { ok: false; error: ApiErrorCode; message?: string };

export type InfoResponse = ResponseBase & {
  firmware: string;
  linkProtocol: number;
  /** link protocol revision (firmware ≥ 2.9; missing = 1). 2 = hold reporting (`charge`, `release` on peripherals); 5 = firmware 2.15 */
  linkRevision?: number;
  setId: string;
  generation: number;
  storeHash: string;
  freeBytes: number;
  maxFileSize: number;
  maxPathLength: number;
  maxRequest: number;
  maxGetChunk: number;
  /** BLE only (firmware ≥ 2.7) */
  mtu?: number;
  transport?: string;
  blockTypes: string[];
  /** stored set name, "" = none (firmware ≥ 2.2) */
  setName?: string;
  /** a PIN is set and this transport needs it (firmware ≥ 2.6) */
  pinRequired?: boolean;
  /** revision of block fields, ports and semantics (firmware ≥ 2.3; missing = 1) */
  programFormat?: number;
  /** optional API features (firmware ≥ 2.4; missing = none) */
  features?: PodFeature[];
};

/**
 * `validateInline`: validate accepts `data`; `listMeta`: list reports program metadata;
 * `pause` (firmware ≥ 2.12): the ops pause and resume.
 * `liveBle` (firmware ≥ 2.12): the central keeps BLE during the game, file changes answer `busy` from DISCOVERY on.
 * `identify` (firmware ≥ 2.13): the op `blink` (find a pod); `status.pods[]` has `number` and `color`.
 * `battery` (firmware ≥ 2.13): `battery` in `status` and `pods[]` (BatteryLevel).
 * `patterns` (firmware ≥ 2.15): the op `pattern` (PatternName) plays a system pattern on a pod.
 */
export type PodFeature = "validateInline" | "listMeta" | "reports" | "remote" | "pause" | "liveBle" | "identify" | "battery" | "patterns" | (string & {});

/** System patterns of the `pattern` op (firmware ≥ 2.15). Endless ones run until the next op. */
export type PatternName = "boot" | "search" | "joined" | "discovery" | "ready" | "select" | "selectCancel" | "selected" | "paused" | "lowBattery" | "sleep";

/** `pattern` (firmware ≥ 2.15, feature `patterns`): durationMs 0 = endless; selectCancel lasts fillMs. */
export type PatternResponse = ResponseBase & { pattern: PatternName; durationMs: number };

/** Battery of a pod (firmware ≥ 2.13): percent of a single Li-ion cell (3.3 V = 0, 4.2 V = 100) and the cell voltage. */
export type BatteryLevel = { percent: number; mv: number };

export type FileEntry = {
  path: string;
  size: number;
  crc: string;
  /** program metadata (`listMeta`, firmware ≥ 2.5): as in the file, left out if missing */
  name?: string;
  peripherals?: unknown;
  menu?: unknown;
  /** a JSON object without `name` (include fragment) */
  fragment?: boolean;
};

export type ListResponse = ResponseBase & {
  generation: number;
  storeHash: string;
  files: FileEntry[];
  menu: string[];
};

export type GetResponse = ResponseBase & {
  path: string;
  offset: number;
  size: number;
  crc: string;
  eof: boolean;
  data: string;
};

export type PutResponse = ResponseBase & {
  path: string;
  /** partial chunk */
  received?: number;
  /** final chunk */
  size?: number;
  crc?: string;
  generation?: number;
};

export type DeleteResponse = ResponseBase & { path: string; generation: number };
export type ValidateResponse = ResponseBase & { path: string; blocks: number };
export type SetNameResponse = ResponseBase & { setName: string };

export type PodRole = "central" | "peripheral" | "booting";

/** The part of `status` the app uses; the full response has more fields. */
export type StatusResponse = ResponseBase & {
  role: PodRole;
  state?: string;
  firmware: string;
  uptimeMs: number;
  setId: string;
  /** BLE only (firmware ≥ 2.7) */
  mtu?: number;
  store: { generation: number; hash: string };
  /** firmware ≥ 2.13: the level of this pod (missing = unknown, e.g. no reading yet) */
  battery?: BatteryLevel;
  /** central: the game is paused by the phone (`pause`, firmware ≥ 2.12); missing = false */
  phonePaused?: boolean;
  /** firmware ≥ 2.12 */
  heap?: { free: number; minFree: number };
  /** central, firmware ≥ 2.12: BLE connection; intervalMs 0 = not known yet */
  ble?: { connected: boolean; intervalMs: number };
  /** central, firmware ≥ 2.11: who trains now ("" = none) */
  athlete?: string;
  /** central, firmware ≥ 2.11: while a `communicate` block waits (config-api.md §5) */
  waiting?: { block: string; editable: Record<string, { min: number; max: number; value: number }> };
  /** central: one entry per peripheral of the set */
  pods?: PodStatus[];
};

/** One peripheral of the set in `status.pods` (config-api.md §5). `number` and `color` are firmware ≥ 2.13. */
export type PodStatus = {
  id: number;
  /** the number shown on the pod (1 … 7 = id + 1) */
  number?: number;
  /** the identity colour as "#rrggbb" */
  color?: string;
  alive: boolean;
  lastSeenMs: number;
  effects?: boolean;
  hold?: boolean;
  toggle?: boolean;
  /** firmware ≥ 2.13: missing = unknown (older pod or no reading) */
  battery?: BatteryLevel;
};

/** `blink` (firmware ≥ 2.13, feature `identify`). `pod` -1 = the central itself. */
export type BlinkResponse = ResponseBase & { pod: number; durationMs: number };

/**
 * `reports` (firmware ≥ 2.11). Request fields `from` (index into the unacknowledged reports,
 * default 0) and `max` (count, default all) page the answer; without them all are returned.
 * `total` = unacknowledged reports, `more` = reports follow this page (paging: firmware ≥ 2.12).
 */
export type ReportsRequest = { from?: number; max?: number };
export type ReportsResponse = ResponseBase & {
  reports: Record<string, unknown>[];
  total?: number;
  more?: boolean;
};

/** Event lines on the USB serial port (§5 Events). */
export type PodEvent = { event: string; [field: string]: unknown };
