import React from "react";
import { Tabs } from "expo-router";
import { C, Icon, IconName } from "../../components/ui";
const icons: Record<string, IconName> = {
  index: "mic-outline",
  chats: "chatbubbles-outline",
  calgary: "calendar-outline",
  settings: "options-outline",
};
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: C.green,
        tabBarInactiveTintColor: "#727C71",
        tabBarStyle: {
          backgroundColor: "#FCFBF7",
          borderTopColor: C.line,
          paddingTop: 9,
          paddingBottom: 9,
          minHeight: 73,
          height: 79,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", marginTop: 3 },
        tabBarIcon: ({ color }) => (
          <Icon
            name={icons[route.name] ?? "ellipse-outline"}
            size={23}
            color={typeof color === "string" ? color : C.green}
          />
        ),
      })}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Speak", tabBarAccessibilityLabel: "Speak" }}
      />
      <Tabs.Screen
        name="chats"
        options={{ title: "Chats", tabBarAccessibilityLabel: "Chats" }}
      />
      <Tabs.Screen
        name="calgary"
        options={{ title: "Calgary", tabBarAccessibilityLabel: "Calgary" }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarAccessibilityLabel: "Settings" }}
      />
    </Tabs>
  );
}
