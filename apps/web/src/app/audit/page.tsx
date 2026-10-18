import { AuditConsole } from "@/components/AuditConsole";
import { AuditUnavailable } from "@/components/access/AuditUnavailable";
export default function AuditPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return <AuditUnavailable/>;
  return <AuditConsole />;
}
