import React, { useState } from "react";
import { Image, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Badge, Body, Button, C, Card, Icon, s } from "./ui";

export type CapturedPhoto = { uri: string; width?: number; height?: number };

export function SceneCapture({
  photos,
  onChange,
  busy = false,
  error = "",
  onAnalyze,
}: {
  photos: CapturedPhoto[];
  onChange: (photos: CapturedPhoto[]) => void;
  busy?: boolean;
  error?: string;
  onAnalyze?: () => void;
}) {
  const [localError, setLocalError] = useState("");

  async function pick(from: "camera" | "library") {
    setLocalError("");
    try {
      if (from === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setLocalError("Camera permission is needed to photograph the gathering.");
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.7,
          allowsEditing: false,
          exif: false,
        });
        if (result.canceled || !result.assets[0]?.uri) return;
        const asset = result.assets[0];
        onChange(
          [...photos, { uri: asset.uri, width: asset.width, height: asset.height }].slice(
            0,
            3,
          ),
        );
        return;
      }
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setLocalError("Photo library permission is needed to choose a picture.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, 3 - photos.length),
        exif: false,
      });
      if (result.canceled || !result.assets.length) return;
      const next = [
        ...photos,
        ...result.assets.map((asset) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        })),
      ].slice(0, 3);
      onChange(next);
    } catch {
      setLocalError("Could not open the camera or photo library. Try again.");
    }
  }

  return (
    <Card>
      <View style={s.row}>
        <Icon name="camera-outline" />
        <Body style={{ fontWeight: "700", flex: 1 }}>Snap the scene</Body>
        <Badge>{photos.length}/3</Badge>
      </View>
      <Body muted>
        Take a photo of the gathering (or choose one). StepIn uses it for
        approach advice — not continuous video, and not face recognition.
      </Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          title="Take photo"
          icon="camera"
          onPress={() => void pick("camera")}
          disabled={busy || photos.length >= 3}
        />
        <Button
          secondary
          title="Choose photo"
          icon="images-outline"
          onPress={() => void pick("library")}
          disabled={busy || photos.length >= 3}
        />
      </View>
      {photos.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {photos.map((photo) => (
            <View key={photo.uri} style={{ width: "30%" }}>
              <Image
                source={{ uri: photo.uri }}
                style={{
                  width: "100%",
                  height: 72,
                  borderRadius: 10,
                  backgroundColor: C.line,
                }}
                accessibilityLabel="Queued scene photo"
              />
              <Button
                secondary
                title="Remove"
                onPress={() =>
                  onChange(photos.filter((p) => p.uri !== photo.uri))
                }
                disabled={busy}
              />
            </View>
          ))}
        </View>
      ) : null}
      {(error || localError) ? (
        <Body style={{ color: C.danger }}>{error || localError}</Body>
      ) : null}
      {onAnalyze ? (
        <Button
          title={
            busy
              ? "Reading the scene…"
              : `Analyze ${photos.length || ""} photo${photos.length === 1 ? "" : "s"}`.trim()
          }
          icon="sparkles-outline"
          onPress={onAnalyze}
          disabled={busy || photos.length === 0}
        />
      ) : null}
    </Card>
  );
}
