import React from "react";
import { Modal, View } from "react-native";
import { Body, Button, C, Card, Title } from "./ui";
export function Confirm({
  visible,
  title,
  description,
  confirm,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#152B2366",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <Card style={{ width: "100%", maxWidth: 430, padding: 25 }}>
          <Title small>{title}</Title>
          <Body muted>{description}</Body>
          <Button title={confirm} danger onPress={onConfirm} />
          <Button title="Keep it" secondary onPress={onCancel} />
        </Card>
      </View>
    </Modal>
  );
}
