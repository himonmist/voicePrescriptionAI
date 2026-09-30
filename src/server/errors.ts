export class NotFoundError extends Error { constructor(m = "Not found") { super(m); this.name = "NotFoundError"; } }
export class ValidationError extends Error { constructor(m = "Invalid input") { super(m); this.name = "ValidationError"; } }
export class ConflictError extends Error {
  constructor(m = "Conflict", public duplicates: unknown[] = []) { super(m); this.name = "ConflictError"; }
}
/** A dependency (e.g. the AI provider) is not configured or failed; nothing was changed. Maps to 503. */
export class UnavailableError extends Error { constructor(m = "Service unavailable") { super(m); this.name = "UnavailableError"; } }
