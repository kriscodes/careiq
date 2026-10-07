import Link from "next/link";
import { designPreviewEnabled } from "@/lib/web-config";
import { AccessHeading, AccessShell } from "./AccessShell";
export function Unavailable() { return <AccessShell><AccessHeading title="Sign-in is unavailable">CareIQ isn’t ready to sign in here yet. Contact your CareIQ administrator, or try again later.</AccessHeading>{designPreviewEnabled(process.env.NODE_ENV) && <Link className="cq-a-secondary" href="/design-preview">Open the design preview</Link>}</AccessShell>; }
