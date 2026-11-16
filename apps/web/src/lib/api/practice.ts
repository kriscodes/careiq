import { apiRequest } from './client';
import type { PracticeCapabilities } from '../capabilities';

export type Location = {
  id: string;
  name: string;
  timeZone: string;
  address?: string | null;
  status?: 'active' | 'closed';
};
export type OwnerAccessProfile = {
  disabledPermissions: string[];
  allLocations: boolean;
  revision: number;
};
export type WorkspaceCapabilities = {
  patientsRead: boolean;
  appointmentsRead: boolean;
  documentsRead: boolean;
  configurationManage: boolean;
};
export type AccessContext = {
  userId: string;
  orgId: string | null;
  practice: {
    id: string;
    name: string;
    authorizationMode: 'legacy' | 'location';
    status: string;
  } | null;
  onboarding: 'required' | 'pending' | 'ready';
  onboardingOrgId?: string | null;
  enrollmentStatus: string | null;
  capabilities: PracticeCapabilities;
  workspaceCapabilities?: WorkspaceCapabilities;
  ownerAccess?: OwnerAccessProfile;
  management: { locations: boolean; members: boolean };
  locations: Location[];
};
export type PracticeMember = {
  userId: string;
  membershipId: string;
  displayName?: string | null;
  email?: string | null;
  status: string;
  role: string | null;
  locationIds: string[];
  proposedLocationIds?: string[];
  isOwner: boolean;
};
export type PracticeInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  locationIds: string[];
  expiresAt: string | null;
  providerRevocationPending?: boolean;
};
export type PracticeAdmin = {
  locations: Location[];
  members: PracticeMember[];
  invitations: PracticeInvitation[];
  allowedRoles: string[];
  ownerAccess: OwnerAccessProfile;
};

export type WorkspaceView =
  | 'Today'
  | 'Schedule'
  | 'Patients'
  | 'Documents'
  | 'Templates'
  | 'Manager'
  | 'Insurance'
  | 'Communications'
  | 'Notifications';

/** Entering the application never grants access to clinical records. */
export function canEnterApplication(context: AccessContext): boolean {
  if (
    typeof context.orgId !== 'string' ||
    !context.orgId.trim() ||
    context.orgId !== context.orgId.trim() ||
    !context.practice ||
    context.practice.status !== 'active' ||
    context.onboarding !== 'ready'
  ) {
    return false;
  }
  return (
    context.practice.authorizationMode === 'legacy' ||
    (context.practice.authorizationMode === 'location' && context.enrollmentStatus === 'active')
  );
}

/** Sidebar destinations use the verified capability reply; location authorization stays separate. */
export function canOpenWorkspaceView(context: AccessContext, view: WorkspaceView): boolean {
  if (!canEnterApplication(context)) {
    return false;
  }
  const caps = context.workspaceCapabilities;
  const patientsRead =
    caps !== undefined
      ? caps?.patientsRead === true
      : context.capabilities?.patients?.read === true;
  const appointmentsRead =
    caps !== undefined
      ? caps?.appointmentsRead === true
      : context.capabilities?.appointments?.read === true;
  const documentsRead = caps?.documentsRead === true;
  const configurationManage = caps?.configurationManage === true;
  switch (view) {
    case 'Today':
    case 'Schedule':
      return appointmentsRead;
    case 'Patients':
      return patientsRead;
    case 'Documents':
      return documentsRead;
    case 'Templates':
      return documentsRead || configurationManage;
    case 'Communications':
      return context.practice?.authorizationMode === 'location' && patientsRead && documentsRead;
    case 'Manager':
    case 'Insurance':
      return context.practice?.authorizationMode === 'location' && patientsRead && appointmentsRead;
    case 'Notifications':
      return context.practice?.authorizationMode === 'location' && appointmentsRead;
    default:
      return false;
  }
}

/** Pick a truthful first workspace view rather than showing unauthorized zero counts. */
export function preferredWorkspaceView(context: AccessContext): WorkspaceView | null {
  return (
    (['Today', 'Patients', 'Documents', 'Templates'] as const).find((view) =>
      canOpenWorkspaceView(context, view),
    ) ?? null
  );
}

export type ClinicalScope =
  | { kind: 'blocked' }
  | { kind: 'legacy' }
  | { kind: 'location'; locationId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Navigation guard only; the API independently authorizes every operation. */
export function resolveClinicalScope(context: AccessContext, locationId: string): ClinicalScope {
  if (
    !context.orgId ||
    !context.practice ||
    context.practice.status !== 'active' ||
    context.onboarding !== 'ready'
  ) {
    return { kind: 'blocked' };
  }
  if (context.practice.authorizationMode === 'legacy') {
    return { kind: 'legacy' };
  }
  if (
    context.practice.authorizationMode !== 'location' ||
    context.enrollmentStatus !== 'active' ||
    !uuid.test(locationId)
  ) {
    return { kind: 'blocked' };
  }
  const location = context.locations?.find((item) => item.id === locationId);
  if (!location || (location.status !== undefined && location.status !== 'active')) {
    return { kind: 'blocked' };
  }
  return { kind: 'location', locationId };
}

/** Mirror the API snapshot admission rule, including documents/configuration-only roles.
 * Older replies can expose only the two original read grants; explicit new replies
 * always take precedence and malformed/false fields never grant navigation.
 */
export function hasWorkspacePermission(context: AccessContext): boolean {
  const capabilities = context.workspaceCapabilities;
  if (capabilities !== undefined) {
    return (
      capabilities?.patientsRead === true ||
      capabilities?.appointmentsRead === true ||
      capabilities?.documentsRead === true ||
      capabilities?.configurationManage === true
    );
  }
  return (
    context.capabilities?.patients?.read === true ||
    context.capabilities?.appointments?.read === true
  );
}

/** The location choice is navigation intent; the API reauthorizes each read. */
export function resolveWorkspaceScope(context: AccessContext, locationId: string): ClinicalScope {
  return hasWorkspacePermission(context)
    ? resolveClinicalScope(context, locationId)
    : { kind: 'blocked' };
}

export async function getAccessContext(token: string, signal?: AbortSignal) {
  return (await apiRequest<{ data: AccessContext }>('/api/v1/me', token, { signal })).data;
}

/** Keep the explicit location in the URL, including every page and retry. */
export function clinicalPath(resource: 'patients' | 'appointments', locationId?: string) {
  if (locationId !== undefined && !uuid.test(locationId)) {
    throw new Error('Choose a valid location before opening records.');
  }
  return locationId === undefined
    ? `/api/v1/${resource}`
    : `/api/v1/locations/${locationId}/${resource}`;
}
