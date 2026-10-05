import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "../src/styles";

export default function FoundationScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>CAREIQ / MOBILE</Text>
        <Text style={styles.title}>Mobile foundation</Text>
        <Text style={styles.body}>
          The starting point for CareIQ on iOS and Android.
        </Text>
        <View style={styles.card}>
          <Text style={styles.label}>Practice and location access</Text>
          <Text style={styles.body}>
            Sign-in, staff invitations, and location-based workflows are
            planned. This preview does not access patient records.
          </Text>
        </View>
        <Link href="/setup" asChild>
          <Pressable accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>Open setup</Text>
          </Pressable>
        </Link>
        <Text style={styles.note}>
          Review the mobile architecture and practice/location proposal before
          adding clinical workflows.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
