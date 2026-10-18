import { createRoot } from "react-dom/client";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { I18nProvider } from "../../../src/i18n/provider";
import { AuthScreen } from "../../../src/components/access/AuthScreen";
function ServerStateProbe() { const { isLoaded } = useAuth(); return <output data-testid="server-auth-state">{isLoaded ? "loaded" : "loading"}</output>; }
const key = "pk_test_" + btoa("auth-stability.invalid$");
createRoot(document.getElementById("root")!).render(<I18nProvider>
  {/* Signed-out SSR auth payloads contain null; the installed shared declaration omits it. */}
  {/* @ts-expect-error Exercise the real serialized signed-out state before SDK load. */}
  <ClerkProvider publishableKey={key} telemetry={false} initialState={{ userId: null, sessionId: null, orgId: null }}><ServerStateProbe /><AuthScreen /></ClerkProvider>
</I18nProvider>);
