import React from "react";
import { View } from "react-native";
import { Badge, Body, Card, Icon, s } from "./ui";
import {
  glassesUnavailableReason,
  isGlassesBuild,
} from "../src/services/glassesCapability";
import { audioRouteLabel } from "../src/services/audioRoute";
import type { CapturedStill } from "./GlassesPanelNative";

export type { CapturedStill };

/**
 * Lazily loads the DAT native UI only inside a custom build so Expo Go never
 * executes requireNativeModule("EMWDAT").
 */
export function GlassesPanel({
  onStillReady,
  onConnectedChange,
}: {
  onStillReady?: (still: CapturedStill | null) => void;
  onConnectedChange?: (connected: boolean) => void;
}) {
  if (!isGlassesBuild()) {
    return (
      <Card>
        <View style={s.row}>
          <Icon name="glasses-outline" />
          <Body style={{ fontWeight: "700", flex: 1 }}>Meta glasses</Body>
          <Badge warm>NEEDS DEV BUILD</Badge>
        </View>
        <Body muted>{glassesUnavailableReason()}</Body>
        <Body muted style={s.small}>
          {audioRouteLabel("phone")}
        </Body>
        <Body style={s.small}>
          After installing a development build: pair glasses in Meta AI, enable
          Developer Mode (tap App version 5×), register StepIn, allow camera,
          then use Capture still. Mic and speaker use Bluetooth HFP/A2DP with
          the existing recorder and Read aloud.
        </Body>
      </Card>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GlassesPanelNative } = require("./GlassesPanelNative") as typeof import("./GlassesPanelNative");
  return (
    <GlassesPanelNative
      onStillReady={onStillReady}
      onConnectedChange={onConnectedChange}
    />
  );
}
