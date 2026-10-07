import { statSync } from "node:fs";
import { join } from "node:path";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { normalizeClerkContinuation } from "@/lib/clerk-continuation";
import { designPreviewEnabled, isDesignPreviewPath } from "@/lib/web-config";
const apiOrigin = (() => { try { return process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : undefined; } catch { return undefined; } })();
const clerkProxy = clerkMiddleware({
  ...(process.env.NODE_ENV === "production" ? { contentSecurityPolicy: {
    strict: true,
    directives: {
      "connect-src": apiOrigin ? [apiOrigin] : [],
      "img-src": ["data:"],
      "frame-ancestors": ["'none'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
    },
  } } : {}),
});
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Only generated, owner-supplied association documents are public. Never synthesize identities.
  const associationFile = request.nextUrl.pathname === "/.well-known/apple-app-site-association" ? "apple-app-site-association" : request.nextUrl.pathname === "/.well-known/assetlinks.json" ? "assetlinks.json" : null;
  if (associationFile) {
    let present = false;
    try { present = statSync(join(process.cwd(), "public", ".well-known", associationFile)).isFile(); } catch { /* Missing setup stays 404. */ }
    return present ? NextResponse.next({ headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } }) : new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  // Cover the static HTML/PNG files as well as the gallery page. Never publish the reviewer harness.
  if (isDesignPreviewPath(request.nextUrl.pathname)) return designPreviewEnabled(process.env.NODE_ENV)
    ? NextResponse.next()
    : new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  const response = await clerkProxy(request, event);
  return response instanceof Response ? normalizeClerkContinuation(response, request.nextUrl.href) : response;
}
export const config = { matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)", "/__clerk/(.*)", "/design-preview(.*)", "/(.*%.*)"] };
