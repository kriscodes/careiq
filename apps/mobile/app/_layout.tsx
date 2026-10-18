import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Providers } from "../src/providers";
import { LocaleProvider } from "../src/i18n";
export default function RootLayout() {
  return <SafeAreaProvider><LocaleProvider scope="staff"><Providers><StatusBar style="dark" /><Stack screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: "#fff"
        },
        animation: "slide_from_right"
      }} /></Providers></LocaleProvider></SafeAreaProvider>;
}
