import { z } from "zod";

/** Shared schema pieces of the API. */
export const Id = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true }).describe("ISO 8601 timestamp");
export const Locale = z.enum(["en", "de"]);
export const Ok = z.object({ ok: z.literal(true) });
export const ok = { ok: true as const };
/** Date → ISO string for outputs. */
export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
