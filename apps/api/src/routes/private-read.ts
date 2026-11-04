import type { Request } from 'express';
import { body, WorkflowError } from '../workflow/policy.js';

/** Private filters belong in JSON bodies, never in URLs or access logs. */
export function privateReadBody(request: Request, allowed: string[]): Record<string, unknown> {
  if (Object.keys(request.query).length) {
    throw new WorkflowError('INVALID_QUERY');
  }
  return body(request.body, allowed);
}

export function requirePublicQueryKeys(request: Request, allowed: string[]): void {
  if (Object.keys(request.query).some((key) => !allowed.includes(key))) {
    throw new WorkflowError('PRIVATE_FILTER_REQUIRES_POST', 400);
  }
}
