/**
 * In-memory pod that implements the configuration API (doc/config-api.md) like the firmware
 * (src/Config/ConfigApi.cpp, src/Store/ProgramStore.cpp). Used for development, unit tests and
 * demos without hardware. Radio, sync and games are not simulated.
 */
import { BLOCK_TYPES } from "../../model/blockTypes";
import { INDEX_PATH, isValidPath, MAX_FILE_SIZE, MAX_GET_CHUNK, MAX_PATH, MAX_REQUEST } from "../../model/limits";
import { validateProgram, type Issue } from "../../model/validate";
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
};

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
  blockTypes: string[];
  freeBytes: number;
  /** answers the next n requests with `overflow`, like a BLE receive buffer overrun */
  overflowNext = 0;

  private upload: { path: string; data: string; bytes: number } | null = null;

  constructor(options: SimulatedPodOptions = {}) {
    for (const [path, text] of Object.entries(options.files ?? {})) this.files.set(path, text);
    this.role = options.role ?? "central";
    this.setId = options.setId ?? "5f3a91c2";
    this.generation = options.generation ?? 1;
    this.firmware = options.firmware ?? "2.0";
    this.blockTypes = options.blockTypes ?? BLOCK_TYPES.map((t) => t.type);
    this.freeBytes = options.freeBytes ?? 1_800_000;
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
        return { ops: ["help", "status", "info", "list", "get", "put", "delete", "validate"], transport: "simulated" };
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
      default:
        throw new ApiFailure("bad_request", `unknown op '${op}' (try 'help')`);
    }
  }

  private info(): Json {
    return {
      firmware: this.firmware,
      linkProtocol: 1,
      setId: this.setId,
      generation: this.generation,
      storeHash: this.storeHash,
      freeBytes: this.freeBytes,
      maxFileSize: MAX_FILE_SIZE,
      maxPathLength: MAX_PATH,
      maxRequest: MAX_REQUEST,
      maxGetChunk: MAX_GET_CHUNK,
      transport: "simulated",
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
    };
  }

  private list(): Json {
    let menu: unknown[] = [];
    try {
      const index = JSON.parse(this.files.get(INDEX_PATH) ?? "") as Json;
      if (Array.isArray(index.programs)) menu = index.programs;
    } catch {
      // no or broken index: empty menu, like the firmware
    }
    return { generation: this.generation, storeHash: this.storeHash, files: this.fileList(), menu };
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
    if (!isValidPath(path) || !this.files.has(path)) throw new ApiFailure("not_found", "program file not found");
    const resolved = validateProgram(path, (p) => this.files.get(p), { supportedTypes: this.blockTypes });
    const error = resolved.issues.find((issue) => issue.severity === "error");
    if (error) throw new ApiFailure("invalid_program", describe(error));
    return { path, blocks: resolved.blocks.length };
  }
}

/** Roughly the firmware's loader message, e.g. "/prog/x.json: block 'Hit': unknownType type=buton". */
function describe(issue: Issue): string {
  const where = issue.block ? `${issue.file}: block '${issue.block}'` : issue.file;
  const params = Object.entries(issue.params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${where}: ${issue.code}${params ? ` ${params}` : ""}`;
}
