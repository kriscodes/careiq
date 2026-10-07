"use client";
import { AccessHeading, AccessShell } from "@/components/access/AccessShell";
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <AccessShell><AccessHeading title="We couldn’t open this page">Your account and saved setup remain with CareIQ. Try opening the page again.</AccessHeading><button className="cq-a-primary" type="button" onClick={retry}>Try again</button><a className="cq-a-link" href="/sign-in">Back to sign in</a></AccessShell>;
}
