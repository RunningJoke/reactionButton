import { join } from "node:path";
import { loadLibrary } from "../src/adapters/library";
import type { Ports } from "../src/core/ports";
import { createApp } from "../src/http/app";

export const ports: Ports = {
  library: loadLibrary(join(import.meta.dirname, "../../firmware/data")),
  clock: () => new Date("2026-10-19T12:00:00Z"),
};

export const testApp = () => createApp({ ports, corsOrigins: ["http://localhost:5173"], publicUrl: "http://localhost:8787" });

/** A small valid program. */
export const program = {
  version: 1,
  name: "Test",
  start: "Blink",
  blocks: [
    { name: "Blink", type: "led", color: "red", next: "Wait" },
    { name: "Wait", type: "delay", ms: 500, next: "Blink" },
  ],
};
