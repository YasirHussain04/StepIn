import { useState } from "react";
// Expo Go has no built-in speech recognizer. Let the platform keyboard provide dictation.
export function useVoiceInput(_onText: (text: string) => void) {
  const [error] = useState("");
  return {
    supported: false,
    listening: false,
    error,
    start: () => {},
    stop: () => {},
  };
}
