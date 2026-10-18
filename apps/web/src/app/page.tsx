import { AuthScreen } from "@/components/access/AuthScreen";
import { PracticeWorkspace } from "@/components/PracticeWorkspace";
import { Unavailable } from "@/components/access/Unavailable";
import type { AccessView } from "@/components/PracticeAccess";
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return <Unavailable />;
  const query = await searchParams;
  if (query.__clerk_ticket) return <AuthScreen invitation invitationComplete={query.__clerk_status === "complete"} />;
  const initialView: AccessView = query.invitations === "1" ? "invitations" : query.manage === "invite" ? "invite" : query.manage === "owneraccess" ? "owneraccess" : "entry";
  const interviewMode = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_INTERVIEW_MODE !== "false";
  return <PracticeWorkspace interviewMode={interviewMode} initialView={initialView} />;
}
