import React, { useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useVoiceInput } from "../src/services/useVoiceInput";
import { Badge, Body, Button, C, Card, Icon, s, serif } from "./ui";

export function RoomComposer({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (description: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [voiceInfo, setVoiceInfo] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const voice = useVoiceInput((t) =>
    setText((prev) => `${prev}${prev ? " " : ""}${t}`.slice(0, 2000)),
  );
  useFocusEffect(React.useCallback(() => () => voice.stop(), []));
  function activateVoice() {
    if (voice.listening) {
      voice.stop();
      return;
    }
    setVoiceInfo(true);
    if (!voice.supported) input.current?.focus();
  }
  return (
    <Card style={{ alignItems: "center", paddingVertical: 25, gap: 16 }}>
      <Badge warm>YOUR WORDS. YOUR PACE.</Badge>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          voice.listening
            ? "Stop voice input"
            : voice.supported
              ? "Show voice input options"
              : "Focus description for keyboard dictation"
        }
        disabled={disabled}
        onPress={activateVoice}
        style={({ pressed }) => ({
          width: 112,
          height: 112,
          borderRadius: 56,
          backgroundColor: voice.listening ? C.peach : "#E7EDDE",
          borderWidth: 9,
          borderColor: "#F3F5ED",
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed || disabled ? 0.6 : 1,
        })}
      >
        <Icon name={voice.listening ? "stop" : "mic-outline"} size={38} />
      </Pressable>
      <View style={{ alignItems: "center", gap: 5 }}>
        <Text style={{ fontFamily: serif, fontSize: 24, color: C.ink }}>
          {voice.listening ? "Listening to you…" : "What’s on your mind?"}
        </Text>
        <Body muted style={{ textAlign: "center", fontSize: 13 }}>
          {voice.supported
            ? "Speak or type. Review your words before sending."
            : "Speak with your keyboard’s mic, or type below."}
        </Body>
      </View>
      {voiceInfo && (
        <View
          style={{
            alignSelf: "stretch",
            gap: 10,
            backgroundColor: C.sage,
            padding: 14,
            borderRadius: 12,
          }}
        >
          <Body style={{ fontSize: 13 }}>
            {voice.supported
              ? "Your browser’s speech service may process audio remotely. StepIn receives only the resulting text; no audio is saved by StepIn."
              : Platform.OS === "web"
                ? "This browser does not offer speech recognition. Use your device keyboard’s dictation or type your description."
                : "Tap the microphone on your iOS or Android keyboard to dictate here. Your keyboard provider handles speech processing. StepIn receives only your text."}
          </Body>
          {voice.supported && (
            <Button
              title={voice.listening ? "Stop listening" : "Start voice input"}
              icon={voice.listening ? "stop" : "mic-outline"}
              onPress={voice.listening ? voice.stop : voice.start}
            />
          )}
        </View>
      )}
      {!!voice.error && <Body style={{ color: C.danger }}>{voice.error}</Body>}
      <TextInput
        ref={input}
        accessibilityLabel="Describe your room or situation"
        placeholder="I’m at a community event, and…"
        placeholderTextColor={C.muted}
        multiline
        maxLength={2000}
        value={text}
        onChangeText={setText}
        style={[
          s.input,
          { minHeight: 105, width: "100%", textAlignVertical: "top" },
        ]}
      />
      <View style={{ width: "100%", gap: 10 }}>
        <Button
          title="Help me get started"
          icon="arrow-forward"
          disabled={disabled || !text.trim() || voice.listening}
          onPress={() => {
            voice.stop();
            onSubmit(text.trim());
          }}
        />
        <Body style={[s.small, { textAlign: "center" }]}>
          Offline practice · new descriptions receive clarification
        </Body>
      </View>
    </Card>
  );
}
