import {
  ISSUE_CODES,
  MAX_FILE_SIZE,
  MAX_INCLUDE_DEPTH,
  MAX_PATH,
  MAX_PERIPHERALS,
  PROGRAM_FORMAT,
  validateProgram as validate,
} from "@reactpod/program-model";
import { z } from "zod";
import pkg from "../../../package.json" with { type: "json" };
import { defineUseCase } from "../../core/useCase";

/** Features the API offers; clients check them like the app checks `info` on a pod (spec §5.4). */
export const FEATURES = ["validate", "accounts", "orgs", "programs", "presets", "sets"] as const;

export const getMeta = defineUseCase({
  name: "get_meta",
  title: "API information",
  description:
    "Version of the ReactPod platform API, the program format it understands, its features and limits. " +
    "Call this first to find out what the platform supports.",
  http: { method: "get", path: "/v1/meta" },
  tag: "meta",
  agent: "allow",
  readOnly: true,
  input: z.object({}),
  output: z.object({
    api: z.literal("v1"),
    version: z.string().describe("platform release"),
    programFormat: z.number().int().describe("PROGRAM_FORMAT revision of block fields and semantics (programs.md §6)"),
    features: z.array(z.string()),
    limits: z.object({
      maxFileSize: z.number().int().describe("bytes per program file"),
      maxPath: z.number().int().describe("characters per store path"),
      maxIncludeDepth: z.number().int(),
      maxPeripherals: z.number().int(),
    }),
  }),
  run: async () => ({
    api: "v1" as const,
    version: pkg.version,
    programFormat: PROGRAM_FORMAT,
    features: [...FEATURES],
    limits: {
      maxFileSize: MAX_FILE_SIZE,
      maxPath: MAX_PATH,
      maxIncludeDepth: MAX_INCLUDE_DEPTH,
      maxPeripherals: MAX_PERIPHERALS,
    },
  }),
});

const Issue = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.enum(ISSUE_CODES),
  file: z.string().describe("store path of the file the issue is in"),
  block: z.string().optional(),
  field: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const validateProgram = defineUseCase({
  name: "validate_program",
  title: "Validate a program",
  description:
    "Checks a ReactPod program with the same rules as the Config App and the firmware loader " +
    "(docs/firmware/programs.md). Pass the program file and any include files it needs; the shipped " +
    "library parts (/prog/lib/*.json) are available without passing them. Errors stop a program from " +
    "running on a pod, warnings do not.",
  http: { method: "post", path: "/v1/programs/validate" },
  tag: "programs",
  agent: "allow",
  readOnly: true,
  input: z.object({
    path: z
      .string()
      .default("/prog/program.json")
      .describe("store path of the program among `files`, e.g. /prog/sprint.json"),
    files: z
      .record(z.string(), z.string())
      .describe("store path → file text (JSON as stored on the pod); must contain `path`"),
    supportedTypes: z
      .array(z.string())
      .optional()
      .describe("block types of the target pod (`info.blockTypes`); others become errors"),
  }),
  output: z.object({
    valid: z.boolean().describe("true if there is no error"),
    issues: z.array(Issue),
  }),
  run: async (ctx, { path, files, supportedTypes }) => {
    const source = (p: string) => files[p] ?? ctx.ports.library[p];
    const { issues } = validate(path, source, { supportedTypes });
    return { valid: !issues.some((i) => i.severity === "error"), issues };
  },
});

export const metaUseCases = [getMeta, validateProgram];
