import type { Response } from 'express';
import { isDatabaseBusy } from '../availability.js';
import { logFailure } from '../logging.js';
import { AccessError } from '../services/practice-policy.js';

type ClinicalResource = 'patients' | 'appointments';
type ClinicalOperation = 'list' | 'create';
type PublicFailure = { status: number; message: string };

const createFailures = new Map<string, PublicFailure>([
  [
    'HISTORIC_IDEMPOTENCY_CONFLICT',
    {
      status: 409,
      message: 'This historic retry requires reconciliation before another write.',
    },
  ],
  [
    'IDEMPOTENCY_KEY_REUSED',
    {
      status: 409,
      message:
        'This retry key was already used for a different request. Please start a new request.',
    },
  ],
  [
    'INVALID_IDEMPOTENCY_KEY',
    {
      status: 400,
      message: 'Idempotency-Key must be a UUID version 4.',
    },
  ],
]);

function publicFailure(
  code: string,
  resource: ClinicalResource,
  operation: ClinicalOperation,
): PublicFailure | undefined {
  if (code === 'LOCATION_CONTEXT_REQUIRED') {
    return { status: 409, message: 'Select a location in the current CareIQ client.' };
  }
  if (code === 'LOCATION_ACCESS_DENIED') {
    return {
      status: 403,
      message:
        operation === 'list'
          ? 'Location access has changed.'
          : 'Location access has changed. Reload your context.',
    };
  }
  if (operation === 'create') {
    if (resource === 'appointments' && code === 'PATIENT_NOT_FOUND') {
      return { status: 404, message: 'The selected patient could not be found for this practice.' };
    }
    return createFailures.get(code);
  }
}

/** Preserve the clinical API contract while keeping exception details off the wire. */
export function clinicalFailure(
  res: Response,
  error: unknown,
  resource: ClinicalResource,
  operation: ClinicalOperation,
): void {
  if (isDatabaseBusy(error)) {
    res.setHeader('Retry-After', '1');
    res.status(503).json({
      error: {
        code: 'DATABASE_BUSY',
        message: 'This service is busy. Please try again shortly.',
        retryable: true,
      },
    });
    return;
  }
  if (error instanceof AccessError) {
    const failure = publicFailure(error.code, resource, operation);
    if (failure) {
      res.status(failure.status).json({ error: { code: error.code, message: failure.message } });
      return;
    }
  }
  logFailure(`Failed to ${operation} ${resource}`, error);
  const code = `${resource === 'patients' ? 'PATIENT' : 'APPOINTMENT'}_${operation === 'list' ? 'LIST' : 'CREATE'}_FAILED`;
  const message =
    operation === 'list'
      ? `Unable to load ${resource}.`
      : `Unable to create ${resource === 'patients' ? 'patient' : 'appointment'}.`;
  res.status(500).json({ error: { code, message } });
}
