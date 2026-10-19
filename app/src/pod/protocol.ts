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
  | "auth_required" /** a PIN is set: put / delete / setName need `auth` first (firmware ≥ 2.6) */
  | "auth_failed"; /** wrong PIN, or a retry within 3 s */

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

/** `validateInline`: validate accepts `data`; `listMeta`: list reports program metadata. */
export type PodFeature = "validateInline" | "listMeta" | (string & {});

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
};

/** Event lines on the USB serial port (§5 Events). */
export type PodEvent = { event: string; [field: string]: unknown };
