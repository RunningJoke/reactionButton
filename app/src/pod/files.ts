/** Chunked file transfer (config-api.md §5 get / put). */
import type { PodClient } from "./client";
import { crcHex } from "./crc32";
import { MAX_FILE_SIZE, MAX_GET_CHUNK, MAX_REQUEST } from "@reactpod/program-model";
import { PodError, type PutResponse } from "./protocol";
import { byteLength, splitUtf8 } from "./utf8";

export type Progress = { path: string; bytesDone: number; bytesTotal: number };

export type ReadOptions = {
  /** bytes per `get`, at most `maxGetChunk` of the pod */
  chunkBytes?: number;
  onProgress?: (progress: Progress) => void;
};

export type ReadResult = { text: string; size: number; crc: string };

export async function readFile(client: PodClient, path: string, options: ReadOptions = {}): Promise<ReadResult> {
  const length = Math.min(options.chunkBytes ?? 2048, MAX_GET_CHUNK);
  const parts: string[] = [];
  let offset = 0;
  for (;;) {
    const response = await client.get(path, offset, length);
    const bytes = byteLength(response.data);
    if (bytes === 0 && !response.eof) throw new PodError("protocol", `empty chunk at ${offset}`, "get");
    parts.push(response.data);
    offset += bytes;
    options.onProgress?.({ path, bytesDone: offset, bytesTotal: response.size });
    if (response.eof) {
      const text = parts.join("");
      const crc = crcHex(text);
      if (offset !== response.size || crc !== response.crc.toLowerCase()) {
        throw new PodError("transfer_crc", `${path}: received ${offset} bytes, CRC ${crc}, pod says ${response.size} / ${response.crc}`, "get");
      }
      return { text, size: response.size, crc };
    }
  }
}

export type WriteOptions = {
  /** file bytes per `put` */
  chunkBytes?: number;
  /** `maxRequest` of the pod: no request may be larger */
  maxRequest?: number;
  onProgress?: (progress: Progress) => void;
};

/**
 * Splits a file into put chunks. Each chunk ends at a character boundary and its whole request,
 * after JSON escaping, fits into `maxRequest` bytes.
 */
export function planChunks(path: string, text: string, chunkBytes: number, maxRequest: number): string[] {
  const crc = crcHex(text);
  for (let size = chunkBytes; size >= 64; size = Math.floor(size / 2)) {
    const chunks = splitUtf8(text, size);
    let offset = 0;
    const fits = chunks.every((data, i) => {
      const last = i === chunks.length - 1;
      const request = { op: "put", id: 2 ** 31, path, offset, data, final: last, ...(last ? { crc } : {}) };
      offset += byteLength(data);
      return byteLength(JSON.stringify(request)) + 1 <= maxRequest;
    });
    if (fits) return chunks;
  }
  throw new PodError("too_large", `${path}: cannot split into requests of ${maxRequest} bytes`, "put");
}

/** Uploads a file. The pod only replaces the old file after the final chunk passed CRC and JSON checks. */
export async function writeFile(
  client: PodClient,
  path: string,
  text: string,
  options: WriteOptions = {},
): Promise<PutResponse> {
  const total = byteLength(text);
  if (total > MAX_FILE_SIZE) {
    throw new PodError("too_large", `${path}: ${total} bytes, the pod accepts ${MAX_FILE_SIZE}`, "put");
  }
  const chunks = planChunks(path, text, options.chunkBytes ?? 2048, options.maxRequest ?? MAX_REQUEST);
  const crc = crcHex(text);
  let offset = 0;
  let response: PutResponse | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const data = chunks[i]!;
    const final = i === chunks.length - 1;
    response = await client.put({ path, data, offset, final, ...(final ? { crc } : {}) });
    offset += byteLength(data);
    if (!final && response.received !== offset) {
      throw new PodError("protocol", `${path}: pod received ${response.received}, expected ${offset}`, "put");
    }
    options.onProgress?.({ path, bytesDone: offset, bytesTotal: total });
  }
  return response!;
}
