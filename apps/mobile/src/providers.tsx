import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, useState, type ReactNode } from "react";
import { configuration } from "./environment";
import { SessionProvider } from "./session";
import { Note, Page } from "./ui";
class AuthenticationBoundary extends Component<{
  children: ReactNode;
}, {
  failed: boolean;
}> {
  state = {
    failed: false
  };
  static getDerivedStateFromError() {
    return {
      failed: true
    };
  }
  render() {
    return this.state.failed ? <Page title="Unable to connect your account"><Note>Restart the app and check the authentication connection for this build.</Note></Page> : this.props.children;
  }
}
export function Providers({
  children
}: {
  children: ReactNode;
}) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        gcTime: 0,
        staleTime: 0
      },
      mutations: {
        retry: false
      }
    }
  }));
  return <QueryClientProvider client={client}>{configuration.clerkPublishableKey ? <AuthenticationBoundary><ClerkProvider publishableKey={configuration.clerkPublishableKey} tokenCache={tokenCache}><SessionProvider>{children}</SessionProvider></ClerkProvider></AuthenticationBoundary> : children}</QueryClientProvider>;
}
