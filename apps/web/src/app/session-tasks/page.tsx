import { SessionTasks } from "@/components/access/SessionTasks";
import { Unavailable } from "@/components/access/Unavailable";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY ? <SessionTasks returnTo={typeof query.returnTo === "string" ? query.returnTo : undefined} /> : <Unavailable />;
}
