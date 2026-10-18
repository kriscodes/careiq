import { ScrollView, Text, View, SafeAreaView, useI18n, NativeCopyError } from "../src/i18n";
import { useQuery } from "@tanstack/react-query";
import { Pressable } from "react-native";

import { configuration } from "../src/environment";
import { checkHealth } from "../src/health";
import { styles } from "../src/styles";
export default function SetupScreen() {
  const { t: tx, errorMessage } = useI18n();
  const health = useQuery({
    queryKey: ["health", configuration.apiUrl],
    queryFn: ({
      signal
    }) => {
      if (!configuration.apiUrl) throw new NativeCopyError("mobile.copy.configure_the_api_address_first_e5aef2d");
      return checkHealth(configuration.apiUrl, signal);
    },
    enabled: false
  });
  const disabled = !configuration.apiUrl || health.isFetching;
  return <SafeAreaView style={styles.screen} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{tx("mobile.copy.connect_your_environment_d6874d0")}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>{tx("mobile.copy.api_configuration_1f2a74c")}</Text>
          <Text style={styles.body}>
            {configuration.apiUrl ? tx("mobile.copy.configured_668c5ff") : tx("mobile.copy.not_configured_811931b")}
          </Text>
          <Text style={styles.note}>{tx("mobile.copy.set_expo_public_api_url_in_the_mobile_environment_fi_9768339")}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>{tx("mobile.copy.authentication_configuration_2c04d73")}</Text>
          <Text style={styles.body}>
            {configuration.clerkPublishableKey ? tx("mobile.copy.publishable_key_configured_d898bf8") : tx("mobile.copy.not_configured_811931b")}
          </Text>
          <Text style={styles.note}>{tx("mobile.copy.a_configured_key_prepares_the_provider_and_secure_to_a49e162")}</Text>
        </View>
        {configuration.issues.map(issue => <Text key={issue} style={styles.issue}>
            {tx(issue)}
          </Text>)}
        <Pressable accessibilityRole="button" accessibilityState={{
        disabled,
        busy: health.isFetching
      }} disabled={disabled} style={[styles.button, disabled && styles.buttonDisabled]} onPress={() => {
        void health.refetch();
      }}>
          <Text style={styles.buttonText}>
            {health.isFetching ? tx("mobile.copy.checking_820d600") : tx("mobile.copy.check_connection_14caeff")}
          </Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={health.isError ? styles.issue : styles.body}>
          {health.isFetching ? tx("mobile.copy.checking_the_configured_api_6e4fdca") : health.isError ? errorMessage(health.error) : health.data ? tx("mobile.copy.api_and_database_are_available_9e55200") : tx("mobile.copy.connection_not_checked_c738478")}
        </Text>
        <Text style={styles.note}>{tx("mobile.copy.this_check_calls_the_public_health_endpoint_it_does__e8f9f3f")}</Text>
      </ScrollView>
    </SafeAreaView>;
}
