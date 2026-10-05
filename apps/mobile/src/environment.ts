import { readMobileConfiguration } from "./config";

// Expo inlines only static EXPO_PUBLIC dot-property references at bundle time.
export const configuration = readMobileConfiguration(
  {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  __DEV__,
);
