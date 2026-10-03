/** A form keeps this in memory for its lifetime, within its user/practice scope. */
export function createSubmissionAttempt(makeKey: () => string = () => crypto.randomUUID()) {
  let previous: { payload: string; key: string } | undefined;
  let inFlight: Promise<void> | undefined;
  return {
    get pending() { return inFlight !== undefined; },
    async submit(input: object, save: (key: string) => Promise<void>): Promise<void> {
      if (inFlight) return inFlight;
      const payload = JSON.stringify(input);
      if (!previous || previous.payload !== payload) previous = { payload, key: makeKey() };
      const key = previous.key;
      // Defer even a synchronous failure so the same lock covers every save.
      const request = Promise.resolve().then(() => save(key)).then(() => { previous = undefined; });
      inFlight = request;
      try { await request; }
      finally { if (inFlight === request) inFlight = undefined; }
    },
  };
}

export type SubmissionAttempt = ReturnType<typeof createSubmissionAttempt>;
