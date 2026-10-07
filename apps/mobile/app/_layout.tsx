import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Providers } from "../src/providers";
export default function RootLayout() {
  return <SafeAreaProvider><Providers><StatusBar style="dark" /><Stack screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: "#fff"
        },
        animation: "slide_from_right"
      }} /></Providers></SafeAreaProvider>;
}
