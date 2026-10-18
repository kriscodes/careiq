import { AuthScreen } from "@/components/access/AuthScreen";
import { PracticeWorkspace } from "@/components/PracticeWorkspace";
import { Unavailable } from "@/components/access/Unavailable";
import { invitationOrganizationHint } from "@/lib/access-flow";

/** Browser fallback for verified mobile app links; all membership decisions remain on the API. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return <Unavailable />;
  const query = await searchParams;
  if (typeof query.__clerk_ticket === "string" && query.__clerk_ticket) return <AuthScreen invitation invitationComplete={query.__clerk_status === "complete"} returnTo="/join?accepted=1" />;
  const intendedOrganizationId = invitationOrganizationHint(typeof query.confirm === "string" ? query.confirm : undefined);
  const returnTo = intendedOrganizationId ? `/join?confirm=${intendedOrganizationId}` : query.accepted === "1" ? "/join?accepted=1" : "/join";
  return <PracticeWorkspace initialView={query.accepted === "1" ? "practices" : intendedOrganizationId ? "entry" : "invitations"} returnTo={returnTo} intendedOrganizationId={intendedOrganizationId} />;
}
