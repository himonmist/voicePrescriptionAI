export class NotFoundError extends Error { constructor(m = "Not found") { super(m); this.name = "NotFoundError"; } }
export class ValidationError extends Error { constructor(m = "Invalid input") { super(m); this.name = "ValidationError"; } }
export class ConflictError extends Error {
  constructor(m = "Conflict", public duplicates: unknown[] = []) { super(m); this.name = "ConflictError"; }
}
