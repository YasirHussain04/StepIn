import React from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../src/state/AppProvider";
import { C } from "../components/ui";

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: "#E8EBE2", alignItems: "center" }}>
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: Platform.OS === "web" ? 520 : undefined,
          backgroundColor: C.bg,
        }}
      >
        <AppProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: C.bg },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="quiz" />
            <Stack.Screen name="chat/[id]" />
          </Stack>
        </AppProvider>
      </View>
    </View>
  );
}
