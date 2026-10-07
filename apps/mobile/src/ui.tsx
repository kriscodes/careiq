import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, styles } from "./styles";
export function Page({
  title,
  description,
  children,
  onBack,
  eyebrow
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onBack?: () => void;
  eyebrow?: string;
}) {
  return <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} contentContainerStyle={styles.content}><View style={styles.header}><View style={styles.brandRow}><View style={styles.brandMark} accessible={false}><Text style={{
                color: colors.white,
                fontWeight: "700",
                fontSize: 22
              }}>+</Text></View><Text style={styles.brand}>careiq</Text></View>{onBack && <TextButton onPress={onBack}>Back</TextButton>}</View>{eyebrow && <Text style={styles.note}>{eyebrow}</Text>}<View style={{
          gap: 10
        }}><Text accessibilityRole="header" style={styles.title}>{title}</Text>{description && <Text style={styles.body}>{description}</Text>}</View>{children}<Text style={styles.footer}>A little more room to care.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function Button({
  children,
  onPress,
  busy,
  disabled,
  secondary = false
}: {
  children: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" aria-busy={!!busy} aria-disabled={!!(disabled || busy)} accessibilityState={{
    disabled: !!(disabled || busy),
    busy: !!busy
  }} disabled={disabled || busy} onPress={onPress} style={({
    pressed
  }) => [styles.button, secondary && styles.secondary, (disabled || busy) && styles.buttonDisabled, pressed && {
    opacity: 0.8
  }]}>{busy ? <ActivityIndicator color={secondary ? colors.sage : colors.white} /> : <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{children}</Text>}</Pressable>;
}
export function TextButton({
  children,
  onPress,
  disabled
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" aria-disabled={!!disabled} accessibilityState={{
    disabled: !!disabled
  }} onPress={onPress} disabled={disabled} style={[styles.link, disabled && styles.buttonDisabled]}><Text style={styles.linkText}>{children}</Text></Pressable>;
}
export function Field({
  label,
  hint,
  error,
  code,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  code?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  const [show, setShow] = useState(false);
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.passwordRow}><TextInput {...props} accessibilityLabel={label} accessibilityHint={error || hint} placeholderTextColor="#8a958f" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} secureTextEntry={props.secureTextEntry && !show} style={[styles.input, code && styles.code, focus && styles.inputFocused, error && styles.inputInvalid, props.secureTextEntry && {
        paddingRight: 68
      }]} />{props.secureTextEntry && <Pressable accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} style={styles.passwordToggle} onPress={() => setShow(!show)}><Text style={styles.linkText}>{show ? "Hide" : "Show"}</Text></Pressable>}</View>{(error || hint) && <Text style={error ? styles.issue : styles.note}>{error || hint}</Text>}</View>;
}
export function Feedback({
  error,
  message
}: {
  error?: string | null;
  message?: string | null;
}) {
  return error ? <View accessibilityLiveRegion="polite" style={styles.error}><Text style={styles.issue}>{error}</Text></View> : message ? <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text> : null;
}
export function Progress({
  step
}: {
  step: 1 | 2 | 3;
}) {
  return <View accessible accessibilityLabel={`Step ${step} of 3: ${["Practice", "Location", "Review"][step - 1]}`} style={{
    gap: 9
  }}><Text style={styles.note}>Step {step} of 3 · {["Practice", "Location", "Review"][step - 1]}</Text><View style={styles.progress}>{[1, 2, 3].map(s => <View key={s} style={[styles.progressSegment, s <= step && styles.progressActive]} />)}</View></View>;
}
export function Choice({
  title,
  description,
  selected,
  onPress
}: {
  title: string;
  description?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" aria-selected={!!selected} aria-pressed={!!selected} accessibilityState={{
    selected: !!selected
  }} accessibilityLabel={`${title}${description ? `. ${description}` : ""}`} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={styles.label}>{selected ? "✓ " : ""}{title}</Text>{description && <Text style={styles.note}>{description}</Text>}</Pressable>;
}
export function Note({
  children
}: {
  children: ReactNode;
}) {
  return <View style={styles.noteCard}>{typeof children === "string" ? <Text style={styles.note}>{children}</Text> : children}</View>;
}
const commonZones = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "UTC"];
export function zoneName(zone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en", {
      timeZone: zone,
      timeZoneName: "long"
    }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value;
    return name ? `${name} · ${zone.split("/").at(-1)?.replaceAll("_", " ")}` : zone;
  } catch {
    return zone;
  }
}
export function TimeZoneField({
  value,
  onChange,
  error
}: {
  value: string;
  onChange: (zone: string) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const supported = useMemo(() => typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : commonZones, []);
  const zones = useMemo(() => [...new Set([value, ...commonZones, ...supported])].filter(zone => `${zone.replaceAll("_", " ")} ${zone === "America/Los_Angeles" ? "Pacific" : zone === "America/New_York" ? "Eastern" : zone === "America/Chicago" ? "Central" : zone === "America/Denver" ? "Mountain" : ""}`.toLowerCase().includes(search.toLowerCase())), [value, search, supported]);
  return <View style={styles.field}><Text style={styles.label}>Time zone</Text><Pressable accessibilityRole="button" accessibilityLabel={`Time zone, ${zoneName(value)}. Choose a time zone.`} onPress={() => setOpen(true)} style={[styles.input, error && styles.inputInvalid]}><Text style={styles.body}>{zoneName(value)} ▾</Text></Pressable><Text style={error ? styles.issue : styles.note}>{error || "Suggested from this device. Confirm the time zone for this location."}</Text><Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}><SafeAreaView style={styles.screen}><View style={{
          padding: 24,
          gap: 16
        }}><Text accessibilityRole="header" style={styles.title}>Choose a time zone</Text><Field label="Search city or time zone" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} /><TextButton onPress={() => setOpen(false)}>Done</TextButton></View><FlatList keyboardShouldPersistTaps="handled" data={zones} keyExtractor={zone => zone} contentContainerStyle={{
          padding: 24,
          gap: 8
        }} renderItem={({
          item
        }) => <Choice title={zoneName(item)} selected={item === value} onPress={() => {
          onChange(item);
          setOpen(false);
          setSearch("");
        }} />} ListEmptyComponent={<Text style={styles.note}>No matching time zones. Try a nearby city.</Text>} /></SafeAreaView></Modal></View>;
}
export function Checkbox({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <Pressable accessibilityRole="checkbox" aria-checked={checked} accessibilityLabel={label} accessibilityState={{
    checked
  }} onPress={() => onChange(!checked)} style={{
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    alignItems: "flex-start",
    paddingVertical: 10
  }}><View style={{
      width: 24,
      height: 24,
      borderWidth: 1,
      borderColor: checked ? colors.sage : colors.line,
      borderRadius: 5,
      backgroundColor: checked ? colors.sage : colors.white,
      alignItems: "center",
      justifyContent: "center"
    }}><Text style={{
        color: colors.white,
        fontSize: 16
      }}>{checked ? "✓" : ""}</Text></View><Text style={[styles.body, {
      flex: 1,
      color: colors.ink
    }]}>{label}</Text></Pressable>;
}
