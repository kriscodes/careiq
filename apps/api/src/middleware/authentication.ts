import { clerkMiddleware, getAuth, type ClerkMiddlewareOptions } from "@clerk/express";
import type { RequestHandler } from "express";
import type { ClerkAuthenticationPolicy } from "../public-config.js";
import { clerkIssuer } from "../production-config.js";

type ClerkOptions = Omit<ClerkMiddlewareOptions, "authorizedParties">;

/** Browser azp verification remains strict. Native no-azp sessions require an explicit opt-in. */
export function createAuthenticationMiddleware(policy: ClerkAuthenticationPolicy, options: ClerkOptions = {}): RequestHandler {
  const issuer = clerkIssuer(options.publishableKey ?? process.env.CLERK_PUBLISHABLE_KEY);
  const browser = clerkMiddleware({ ...options, authorizedParties: policy.browserOrigins });
  // Clerk's installed SDK rejects absent azp with a nonempty list. Only this native branch
  // omits that SDK check; it verifies the signature/session then applies the policy below.
  const native = policy.nativeEnabled ? clerkMiddleware({ ...options, authorizedParties: [] }) : null;
  const nativeParties = new Set([...policy.browserOrigins, ...policy.nativeAuthorizedParties]);
  return (req, res, next) => {
    const nativeTransport = /^Bearer\s+\S+$/i.test(req.get("Authorization") ?? "") && req.headers.origin === undefined && req.headers.cookie === undefined && req.headers.referer === undefined && ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"].every((header) => req.headers[header] === undefined);
    const authenticate = native && nativeTransport ? native : browser;
    authenticate(req, res, (error) => {
      if (error) { next(error); return; }
      const auth = getAuth(req);
      if (auth.isAuthenticated) {
        const party: unknown = auth.sessionClaims.azp;
        // The SDK verifies signature/time/category. Bind accepted sessions to
        // the configured instance and require actual session/user identifiers.
        const claims = auth.sessionClaims;
        if (claims.iss !== issuer || typeof claims.sid !== "string" || !/^sess_[A-Za-z0-9]+$/.test(claims.sid) || typeof claims.sub !== "string" || !/^user_[A-Za-z0-9]+$/.test(claims.sub) || (native && nativeTransport && party !== undefined && (typeof party !== "string" || !nativeParties.has(party)))) {
          res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
          return;
        }
      }
      next();
    });
  };
}
