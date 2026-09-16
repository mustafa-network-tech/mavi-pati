import { DEFAULT_LANGUAGE, getLocale, type LanguageCode } from "@/locales";
type RecognitionEvent = {
  results: { [index: number]: { [index: number]: { transcript: string } } };
};
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
export interface SpeechRecognitionProvider {
  supported(): boolean;
  start(
    onText: (text: string) => void,
    onError: (message: string) => void,
    onEnd: () => void,
    language?: LanguageCode,
  ): void;
  stop(): void;
}
export class BrowserSpeechRecognitionProvider implements SpeechRecognitionProvider {
  private active: Recognition | null = null;
  private constructorType() {
    if (typeof window === "undefined") return undefined;
    const browser = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  }
  supported() {
    return !!this.constructorType();
  }
  start(
    onText: (text: string) => void,
    onError: (message: string) => void,
    onEnd: () => void,
    language: LanguageCode = DEFAULT_LANGUAGE,
  ) {
    this.stop();
    const locale = getLocale(language);
    const errors = locale.messages.errors;
    const Type = this.constructorType();
    if (!Type) {
      onError(errors.speechUnsupported);
      onEnd();
      return;
    }
    const recognition = new Type();
    this.active = recognition;
    recognition.lang = locale.speechLocale;
    recognition.continuous = false;
    recognition.interimResults = false;
    let completed = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript?.trim()) {
        completed = true;
        onText(transcript);
      } else {
        completed = true;
        onError(errors.noSpeech);
      }
    };
    recognition.onerror = (event) => {
      completed = true;
      onError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? errors.microphoneDenied
          : event.error === "network"
            ? errors.network
            : errors.noSpeech,
      );
    };
    recognition.onend = () => {
      if (!completed) onError(errors.noSpeech);
      if (this.active === recognition) this.active = null;
      onEnd();
    };
    try {
      recognition.start();
    } catch {
      this.stop();
      onError(errors.microphoneFailed);
      onEnd();
    }
  }
  stop() {
    const recognition = this.active;
    this.active = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      /* Already stopped. */
    }
  }
}
export interface TextToSpeechProvider {
  speak(text: string, onEnd: () => void, language?: LanguageCode): boolean;
  stop(): void;
}
export class BrowserTextToSpeechProvider implements TextToSpeechProvider {
  private active: SpeechSynthesisUtterance | null = null;
  speak(
    text: string,
    onEnd: () => void,
    language: LanguageCode = DEFAULT_LANGUAGE,
  ) {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    )
      return false;
    this.stop();
    const locale = getLocale(language);
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      this.active = utterance;
      utterance.lang = locale.speechLocale;
      const voices = window.speechSynthesis.getVoices();
      const voice =
        voices.find(
          (v) => v.lang.toLowerCase() === locale.speechLocale.toLowerCase(),
        ) ??
        voices.find(
          (v) =>
            v.lang.toLowerCase().startsWith(`${language}-`) ||
            v.lang.toLowerCase() === language,
        );
      if (voice) utterance.voice = voice;
      const finish = () => {
        if (this.active === utterance) {
          this.active = null;
          onEnd();
        }
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }
  stop() {
    if (this.active) {
      this.active.onend = null;
      this.active.onerror = null;
      this.active = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
  }
}
