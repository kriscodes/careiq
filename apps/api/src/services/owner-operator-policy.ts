import { AccessError } from './practice-policy.js';

/** Operational practice permissions only; protected audit and platform operations stay separate. */
export const OWNER_OPERATOR_PERMISSIONS = [
  'org:patients:read',
  'org:patients:create',
  'org:patients:update',
  'org:appointments:read',
  'org:appointments:create',
  'org:appointments:update',
  'org:documents:read',
  'org:documents:upload',
  'org:documents:review',
  'org:documents:archive',
  'org:requests:send',
  'org:requirements:waive',
  'org:requirements:manage',
  'org:work:manage',
  'org:workflow:configure',
  'org:paperwork:manage',
  'org:activity:read',
] as const;
export type OwnerOperatorPermission = (typeof OWNER_OPERATOR_PERMISSIONS)[number];
export const isOwnerOperatorPermission = (value: unknown): value is OwnerOperatorPermission =>
  typeof value === 'string' && (OWNER_OPERATOR_PERMISSIONS as readonly string[]).includes(value);
export function parseOwnerOperatorDisabledPermissions(input: unknown): OwnerOperatorPermission[] {
  if (
    !Array.isArray(input) ||
    input.length > OWNER_OPERATOR_PERMISSIONS.length ||
    input.some((value) => !isOwnerOperatorPermission(value)) ||
    new Set(input).size !== input.length
  ) {
    throw new AccessError(
      'INVALID_OWNER_ACCESS',
      400,
      'Choose only the supported owner permissions, without duplicates.',
    );
  }
  return [...input] as OwnerOperatorPermission[];
}
export function applyOwnerOperatorPermissions(
  rawPermissions: readonly string[],
  ownerOperator: boolean,
  disabledPermissions: readonly string[] = [],
): string[] {
  if (!ownerOperator) {
    return [...rawPermissions];
  }
  const disabled = new Set(parseOwnerOperatorDisabledPermissions(disabledPermissions));
  return [...new Set([...rawPermissions, ...OWNER_OPERATOR_PERMISSIONS])].filter(
    (permission) => !disabled.has(permission as OwnerOperatorPermission),
  );
}
