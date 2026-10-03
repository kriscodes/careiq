export type PracticeCapabilities = {
  patients: { read: boolean; create: boolean };
  appointments: { read: boolean; create: boolean };
};

export const NO_CAPABILITIES: PracticeCapabilities = {
  patients: { read: false, create: false },
  appointments: { read: false, create: false },
};

/** Only explicit server grants enable actions; old/malformed replies fail closed. */
export function practiceCapabilities(value: unknown): PracticeCapabilities {
  const input = value as Partial<Record<keyof PracticeCapabilities, { read?: unknown; create?: unknown }>> | null;
  return {
    patients: { read: input?.patients?.read === true, create: input?.patients?.create === true },
    appointments: { read: input?.appointments?.read === true, create: input?.appointments?.create === true },
  };
}
