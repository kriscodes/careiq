import { StyleSheet } from "react-native";
export const colors = {
  white: "#fff",
  ink: "#202b34",
  muted: "#617080",
  line: "#e1e7ef",
  sage: "#0067e8",
  soft: "#eef5ff",
  danger: "#963f36"
};
export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.white
  },
  keyboard: {
    flex: 1
  },
  content: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: 24,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 20,
    flexGrow: 1
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    marginBottom: 16
  },
  brand: {
    color: colors.sage,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -1.2
  },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.sage,
    alignItems: "center",
    justifyContent: "center"
  },
  brandRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center"
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    lineHeight: 37,
    fontWeight: "600",
    letterSpacing: -0.8
  },
  body: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 25
  },
  card: {
    backgroundColor: colors.white,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    gap: 12
  },
  noteCard: {
    backgroundColor: colors.soft,
    padding: 16,
    borderRadius: 10,
    gap: 8
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600"
  },
  field: {
    gap: 8
  },
  input: {
    color: colors.ink,
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    minHeight: 52
  },
  inputInvalid: {
    borderColor: colors.danger
  },
  inputFocused: {
    borderColor: colors.sage,
    borderWidth: 2,
    paddingHorizontal: 13,
    paddingVertical: 12
  },
  code: {
    textAlign: "center",
    fontSize: 25,
    letterSpacing: 6
  },
  passwordRow: {
    position: "relative"
  },
  passwordToggle: {
    position: "absolute",
    right: 6,
    top: 0,
    minWidth: 58,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center"
  },
  button: {
    backgroundColor: colors.sage,
    borderRadius: 10,
    padding: 15,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonDisabled: {
    opacity: 0.48
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "600"
  },
  secondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line
  },
  secondaryText: {
    color: colors.ink
  },
  link: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 10
  },
  linkText: {
    color: colors.sage,
    fontSize: 14,
    fontWeight: "500"
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 21
  },
  issue: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 22
  },
  error: {
    backgroundColor: "#fff5f3",
    padding: 14,
    borderRadius: 10
  },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap"
  },
  summary: {
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 13,
    gap: 4
  },
  choice: {
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    gap: 5,
    minHeight: 52
  },
  choiceSelected: {
    backgroundColor: colors.soft,
    borderColor: colors.sage
  },
  progress: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4
  },
  progressSegment: {
    height: 3,
    borderRadius: 2,
    flex: 1,
    backgroundColor: colors.line
  },
  progressActive: {
    backgroundColor: colors.sage
  },
  success: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.soft,
    justifyContent: "center",
    alignItems: "center"
  },
  footer: {
    marginTop: "auto",
    paddingTop: 16,
    color: colors.muted,
    fontSize: 12,
    textAlign: "center"
  }
});
