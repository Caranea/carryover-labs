/** A user-facing message for a caught error. Services throw errors with readable messages. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
