import { useEffect, useRef, useState } from "react";
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: {
        results: {
          [index: number]: { [index: number]: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
export function useVoiceInput(onText: (text: string) => void) {
  const ref = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  callback.current = onText;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const ctor =
    typeof window === "undefined"
      ? undefined
      : ((
          window as unknown as {
            SpeechRecognition?: new () => Recognition;
            webkitSpeechRecognition?: new () => Recognition;
          }
        ).SpeechRecognition ??
        (
          window as unknown as {
            webkitSpeechRecognition?: new () => Recognition;
          }
        ).webkitSpeechRecognition);
  useEffect(() => () => ref.current?.abort(), []);
  return {
    supported: !!ctor,
    listening,
    error,
    start: () => {
      if (!ctor) return;
      ref.current?.abort();
      const recognition = new ctor();
      ref.current = recognition;
      recognition.lang = "en-CA";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (event) =>
        callback.current(event.results[0][0].transcript);
      recognition.onerror = () => {
        setError(
          "Voice input is unavailable. Check microphone access, use keyboard dictation, or type below.",
        );
        setListening(false);
      };
      recognition.onend = () => setListening(false);
      try {
        setError("");
        recognition.start();
        setListening(true);
      } catch {
        setError("Could not start voice input. You can type instead.");
      }
    },
    stop: () => {
      ref.current?.abort();
      setListening(false);
    },
  };
}
