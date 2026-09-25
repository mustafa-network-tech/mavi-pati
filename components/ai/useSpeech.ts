"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserTextToSpeechProvider, BrowserVoiceRecorder, toSpeakableText } from "@/lib/speech";

// In-app microphone recording and spoken answers, shared by the clinic advisor and the
// owner assistant. Recording/TTS support is only known in the browser.
export function useSpeech() {
  const recorder = useRef<BrowserVoiceRecorder | null>(null);
  const tts = useRef<BrowserTextToSpeechProvider | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);

  useEffect(() => {
    const voice = new BrowserVoiceRecorder();
    const speech = new BrowserTextToSpeechProvider();
    recorder.current = voice;
    tts.current = speech;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoiceSupported(voice.supported());
    setTtsSupported(speech.supported());
    return () => {
      voice.cancel();
      speech.stop();
    };
  }, []);

  return {
    voiceSupported,
    ttsSupported,
    record(onAudio: (audio: Blob) => void, onError: (message: string) => void, onEnd: () => void) {
      void recorder.current?.start(onAudio, onError, onEnd);
    },
    finishRecording() {
      recorder.current?.stop();
    },
    speak(text: string, onEnd: () => void) {
      return tts.current?.speak(toSpeakableText(text), onEnd) ?? false;
    },
    stopSpeaking() {
      tts.current?.stop();
    },
  };
}
