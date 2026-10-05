import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f3f7f6", padding: 24 },
  content: {
    gap: 20,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingBottom: 32,
  },
  brand: { color: "#117367", fontSize: 19, fontWeight: "700" },
  title: { color: "#19312e", fontSize: 32, fontWeight: "700" },
  body: { color: "#435a56", fontSize: 17, lineHeight: 26 },
  card: { backgroundColor: "#ffffff", padding: 20, borderRadius: 16, gap: 10 },
  label: { color: "#19312e", fontSize: 19, fontWeight: "600" },
  button: {
    backgroundColor: "#116d61",
    borderRadius: 12,
    padding: 16,
    minHeight: 48,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  note: { color: "#566763", fontSize: 15, lineHeight: 23 },
  issue: { color: "#913c27", fontSize: 16, lineHeight: 24 },
});
