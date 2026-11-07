import React, { useEffect, useState } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { acceptAuthUrl } from "../../src/services/auth";
import { Body, Button, Page, Title } from "../../components/ui";
export default function Callback() {
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void Linking.getInitialURL()
      .then((url) => (url ? acceptAuthUrl(url) : undefined))
      .then(() => {
        if (mounted) router.replace("/settings");
      })
      .catch(() => {
        if (mounted)
          setError(
            "This account link could not be completed. Return to Settings and request another link.",
          );
      });
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <Page>
      <Title small>Opening your account…</Title>
      {!!error && <Body>{error}</Body>}
      <Button
        secondary
        title="Back to Settings"
        onPress={() => router.replace("/settings")}
      />
    </Page>
  );
}
