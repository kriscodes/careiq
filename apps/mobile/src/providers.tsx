import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode, useState } from "react";
import { Text, View } from "react-native";
import { configuration } from "./environment";
import { styles } from "./styles";

class AuthenticationBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <View style={styles.screen}>
          <Text style={styles.title}>Unable to open mobile setup</Text>
          <Text style={styles.body}>
            Restart the app and check its configuration. If you recently added a
            Clerk key, verify the key or leave it blank to preview the
            foundation.
          </Text>
        </View>
      );
    return this.props.children;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            gcTime: 0,
          },
          mutations: { retry: false },
        },
      }),
  );
  const content = (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return configuration.clerkPublishableKey ? (
    <AuthenticationBoundary>
      <ClerkProvider
        publishableKey={configuration.clerkPublishableKey}
        tokenCache={tokenCache}
      >
        {content}
      </ClerkProvider>
    </AuthenticationBoundary>
  ) : (
    content
  );
}
