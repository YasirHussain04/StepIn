import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../src/state/AppProvider";

export const C = {
  bg: "#F8F6F0",
  paper: "#FFFFFF",
  ink: "#213E35",
  green: "#285E4A",
  muted: "#626E65",
  line: "#E1E3DA",
  sage: "#E9EEE4",
  peach: "#F4E3D5",
  rust: "#9C4C32",
  danger: "#A13935",
};
export const serif = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia",
});
export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function Icon({
  name,
  size = 22,
  color = C.green,
}: {
  name: IconName;
  size?: number;
  color?: React.ComponentProps<typeof Ionicons>["color"];
}) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessible={false}
      aria-hidden={true}
    />
  );
}
export function Body({
  children,
  muted,
  style,
  ...props
}: React.ComponentProps<typeof Text> & { muted?: boolean }) {
  return (
    <Text {...props} style={[s.body, muted && { color: C.muted }, style]}>
      {children}
    </Text>
  );
}
export function Title({
  children,
  small,
}: {
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <Text
      accessibilityRole="header"
      style={[s.title, small && { fontSize: 29, lineHeight: 36 }]}
    >
      {children}
    </Text>
  );
}
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}
export function Badge({
  children,
  warm = false,
}: {
  children: React.ReactNode;
  warm?: boolean;
}) {
  return (
    <View style={[s.badge, warm && { backgroundColor: C.peach }]}>
      <Text style={[s.badgeText, warm && { color: C.rust }]}>{children}</Text>
    </View>
  );
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Button({
  title,
  onPress,
  secondary,
  disabled,
  icon,
  busy,
  danger,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: IconName;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        danger && { backgroundColor: C.danger },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? C.green : "#fff"} />
      ) : icon ? (
        <Icon name={icon} size={19} color={secondary ? C.green : "#fff"} />
      ) : null}
      <Text style={[s.buttonText, secondary && { color: C.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function TextField(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={C.muted}
      {...props}
      style={[
        s.input,
        props.multiline && { minHeight: 110, textAlignVertical: "top" },
        props.style,
      ]}
    />
  );
}
export function Header() {
  return (
    <View style={s.header}>
      <View style={s.row}>
        <View style={s.logo}>
          <Icon name="footsteps" color="#fff" size={22} />
        </View>
        <Text style={s.wordmark}>
          StepIn<Text style={{ color: C.rust }}>.</Text>
        </Text>
      </View>
      <View style={[s.row, { gap: 4 }]}>
        <Icon name="location-outline" size={15} />
        <Text style={s.city}>Calgary, AB</Text>
      </View>
    </View>
  );
}
export function Page({
  children,
  header = true,
  scrollTrigger,
}: {
  children: React.ReactNode;
  header?: boolean;
  scrollTrigger?: string;
}) {
  const { ready, storageError, retryStorage } = useApp();
  const scroll = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  React.useEffect(() => {
    if (scrollTrigger === undefined) return;
    const timer = setTimeout(
      () => scroll.current?.scrollToEnd({ animated: true }),
      100,
    );
    return () => clearTimeout(timer);
  }, [scrollTrigger]);
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={s.safe}>
      {header && <Header />}
      {storageError && (
        <View style={{ padding: 16, backgroundColor: C.peach }}>
          <Body>{storageError}</Body>
          <Button secondary title="Retry storage" onPress={retryStorage} />
        </View>
      )}
      {ready ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            ref={scroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.content}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : !storageError ? (
        <ActivityIndicator
          style={{ margin: 50 }}
          color={C.green}
          accessibilityLabel="Opening your local data"
        />
      ) : null}
    </SafeAreaView>
  );
}
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 22,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderColor: C.line,
    gap: 12,
  },
  logo: {
    width: 34,
    height: 37,
    backgroundColor: C.green,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    fontSize: 25,
    fontWeight: "700",
    color: C.ink,
    letterSpacing: -1,
  },
  city: { fontSize: 12, color: C.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontFamily: serif,
    color: C.ink,
    fontSize: 39,
    lineHeight: 45,
    letterSpacing: -1.3,
  },
  label: {
    color: C.rust,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.7,
    textTransform: "uppercase",
  },
  body: { fontSize: 15, lineHeight: 23, color: C.ink },
  card: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: C.green,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    flexShrink: 1,
  },
  secondary: {
    backgroundColor: C.sage,
    borderWidth: 1,
    borderColor: "#D8E0D4",
  },
  input: {
    fontSize: 15,
    color: C.ink,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 13,
    padding: 15,
    backgroundColor: "#fff",
    minHeight: 50,
    lineHeight: 22,
  },
  badge: {
    backgroundColor: C.sage,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: C.green,
    letterSpacing: 0.5,
  },
  section: {
    fontSize: 20,
    color: C.ink,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  small: { fontSize: 12, lineHeight: 18, color: C.muted },
  divider: { height: 1, backgroundColor: C.line },
});
