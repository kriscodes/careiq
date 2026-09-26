// Database exceptions may include SQL parameters containing patient details.
// Log a stable operation label and safe error code, never the raw error object.
export function logFailure(operation: string, error: unknown) {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = candidate?.cause?.code ?? candidate?.code;
  console.error(operation, {
    code: typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "UNEXPECTED_ERROR",
  });
}
