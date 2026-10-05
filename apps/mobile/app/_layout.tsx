import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Providers } from "../src/providers";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Providers>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerTintColor: "#19312e",
            headerStyle: { backgroundColor: "#f3f7f6" },
          }}
        >
          <Stack.Screen name="index" options={{ title: "CareIQ" }} />
          <Stack.Screen name="setup" options={{ title: "Setup" }} />
        </Stack>
      </Providers>
    </SafeAreaProvider>
  );
}
