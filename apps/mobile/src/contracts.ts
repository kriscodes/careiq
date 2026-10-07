export type Practice = {
  id: string;
  name: string;
  ownerUserId: string | null;
  status: string;
  authorizationMode: string;
};
export type Location = {
  id: string;
  name: string;
  timeZone: string;
  address: string | null;
  status: string;
};
export type AccessContext = {
  userId: string;
  orgId: string | null;
  sessionId: string;
  practice: Practice | null;
  onboarding: "required" | "pending" | "ready";
  onboardingOrgId?: string | null;
  enrollmentStatus: string | null;
  capabilities: {
    patients: {
      read: boolean;
      create: boolean;
    };
    appointments: {
      read: boolean;
      create: boolean;
    };
  };
  management: {
    locations: boolean;
    members: boolean;
  };
  locations: Location[];
};
export type Draft = {
  practiceName: string;
  locationName: string;
  timeZone: string;
  address: string;
  step: 1 | 2 | 3;
};
export type OnboardingState = {
  eligible: boolean;
  emailVerified: boolean;
  draft: Draft | null;
  operation: {
    state: "pending" | "complete";
    practiceId: string | null;
    organizationId: string | null;
  } | null;
};
export type OnboardingResult = {
  orgId: string;
  practice: Practice;
  location: Location;
};
export type Admin = {
  locations: Location[];
  members: {
    userId: string;
    membershipId: string;
    status: string;
    proposedLocationIds: string[];
    displayName?: string;
    email?: string;
    role: string | null;
    locationIds: string[];
    isOwner: boolean;
  }[];
  invitations: {
    id: string;
    email: string;
    role: string;
    status: string;
    locationIds: string[];
    expiresAt: string;
    providerRevocationPending: boolean;
  }[];
  allowedRoles: string[];
};
export function emptyDraft(): Draft {
  return {
    practiceName: "",
    locationName: "Main location",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
    address: "",
    step: 1
  };
}
export function draftErrors(draft: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!draft.practiceName.trim()) errors.practiceName = "Enter your practice name.";else if (draft.practiceName.trim().length > 120) errors.practiceName = "Use 120 characters or fewer.";
  if (!draft.locationName.trim()) errors.locationName = "Enter a location name.";else if (draft.locationName.trim().length > 120) errors.locationName = "Use 120 characters or fewer.";
  try {
    new Intl.DateTimeFormat("en", {
      timeZone: draft.timeZone
    }).format();
  } catch {
    errors.timeZone = "Choose a valid time zone, such as America/Los_Angeles.";
  }
  if (draft.address.length > 500) errors.address = "Use 500 characters or fewer.";
  return errors;
}
export function onboardingPayload(draft: Draft) {
  return {
    name: draft.practiceName.trim(),
    location: {
      name: draft.locationName.trim(),
      timeZone: draft.timeZone,
      ...(draft.address.trim() ? {
        address: draft.address.trim()
      } : {})
    }
  };
}
export function canEnterLocation(context: AccessContext, id: string): boolean {
  return context.onboarding === "ready" && context.practice?.status === "active" && context.enrollmentStatus === "active" && context.locations.some(location => location.id === id && location.status === "active");
}
