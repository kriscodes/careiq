import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { configuration } from "../src/environment";
import { checkHealth } from "../src/health";
import { styles } from "../src/styles";

export default function SetupScreen() {
  const health = useQuery({
    queryKey: ["health", configuration.apiUrl],
    queryFn: ({ signal }) => {
      if (!configuration.apiUrl)
        throw new Error("Configure the API address first.");
      return checkHealth(configuration.apiUrl, signal);
    },
    enabled: false,
  });
  const disabled = !configuration.apiUrl || health.isFetching;
  return (
    <SafeAreaView style={styles.screen} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Connect your environment</Text>
        <View style={styles.card}>
          <Text style={styles.label}>API configuration</Text>
          <Text style={styles.body}>
            {configuration.apiUrl ? "Configured" : "Not configured"}
          </Text>
          <Text style={styles.note}>
            Set EXPO_PUBLIC_API_URL in the mobile environment file to check
            connectivity.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>Authentication configuration</Text>
          <Text style={styles.body}>
            {configuration.clerkPublishableKey
              ? "Publishable key configured"
              : "Not configured"}
          </Text>
          <Text style={styles.note}>
            A configured key prepares the provider and secure token cache.
            Sign-in is a later step.
          </Text>
        </View>
        {configuration.issues.map((issue) => (
          <Text key={issue} style={styles.issue}>
            {issue}
          </Text>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: health.isFetching }}
          disabled={disabled}
          style={[styles.button, disabled && styles.buttonDisabled]}
          onPress={() => {
            void health.refetch();
          }}
        >
          <Text style={styles.buttonText}>
            {health.isFetching ? "Checking…" : "Check connection"}
          </Text>
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={health.isError ? styles.issue : styles.body}
        >
          {health.isFetching
            ? "Checking the configured API…"
            : health.isError
              ? health.error.message
              : health.data
                ? "API and database are available."
                : "Connection not checked."}
        </Text>
        <Text style={styles.note}>
          This check calls the public health endpoint. It does not authenticate
          you, create a practice, or verify location access.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
