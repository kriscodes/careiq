import { AuthScreen } from "@/components/access/AuthScreen";
import { Unavailable } from "@/components/access/Unavailable";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return <Unavailable />;
  return <AuthScreen returnTo={typeof query.returnTo === "string" ? query.returnTo : undefined} invitation={!!query.__clerk_ticket} invitationComplete={query.__clerk_status === "complete"} expired={query.reason === "expired"} />;
}
