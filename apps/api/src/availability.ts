/** Classify the bounded pool's safe admission failure without importing a database client. */
export function isDatabaseBusy(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'DATABASE_BUSY' && 'status' in error && error.status === 503;
}
