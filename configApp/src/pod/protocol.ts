/** Messages of the configuration API (doc/config-api.md). */

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
  | "not_ready";

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
  mtu?: number;
  transport?: string;
  blockTypes: string[];
};

export type FileEntry = { path: string; size: number; crc: string };

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

export type PodRole = "central" | "peripheral" | "booting";

/** The part of `status` the app uses; the full response has more fields. */
export type StatusResponse = ResponseBase & {
  role: PodRole;
  state?: string;
  firmware: string;
  uptimeMs: number;
  setId: string;
  store: { generation: number; hash: string };
};

/** Event lines on the USB serial port (§5 Events). */
export type PodEvent = { event: string; [field: string]: unknown };
