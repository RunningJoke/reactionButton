/** Errors of the application core. Front doors turn them into problem+json (REST) or tool errors (MCP). */
export class AppError extends Error {
  constructor(
    /** HTTP status the REST door answers with */
    readonly status: number,
    /** stable machine-readable code, e.g. "invalid_input", "forbidden" */
    readonly code: string,
    message: string,
    /** extra fields for the client (e.g. validation issues) */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const invalidInput = (detail: string, extra: Record<string, unknown> = {}) =>
  new AppError(400, "invalid_input", detail, extra);
export const unauthorized = () => new AppError(401, "unauthorized", "Sign in to do this.");
export const forbidden = (detail = "Not allowed.") => new AppError(403, "forbidden", detail);
export const notFound = (detail = "Not found.") => new AppError(404, "not_found", detail);
export const conflict = (detail: string) => new AppError(409, "conflict", detail);
export const tooManyRequests = () => new AppError(429, "too_many_requests", "Too many requests. Try again later.");

/** RFC 9457 problem details. */
export function toProblem(error: AppError, instance?: string) {
  return {
    type: `https://runningjoke.github.io/reactionButton/problems/${error.code}`,
    title: error.code,
    status: error.status,
    detail: error.message,
    ...(instance ? { instance } : {}),
    ...error.extra,
  };
}
