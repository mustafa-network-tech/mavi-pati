type RecognitionEvent = {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
};
type Recognition = {
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
  ): void;
  stop(): void;
}
export class BrowserSpeechRecognitionProvider implements SpeechRecognitionProvider {
  private active: Recognition | null = null;
  private constructorType() {
    return (
      (
        window as unknown as {
          SpeechRecognition?: new () => Recognition;
          webkitSpeechRecognition?: new () => Recognition;
        }
      ).SpeechRecognition ??
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => Recognition;
        }
      ).webkitSpeechRecognition
    );
  }
  supported() {
    return !!this.constructorType();
  }
  start(
    onText: (text: string) => void,
    onError: (message: string) => void,
    onEnd: () => void,
  ) {
    const Type = this.constructorType();
    if (!Type) {
      onError(
        "Tarayıcınız sesli girişi desteklemiyor. Sorunuzu yazabilirsiniz.",
      );
      return;
    }
    this.active = new Type();
    this.active.lang = "tr-TR";
    this.active.continuous = false;
    this.active.interimResults = false;
    this.active.onresult = (e) => onText(e.results[0][0].transcript);
    this.active.onerror = (e) =>
      onError(
        e.error === "not-allowed"
          ? "Mikrofon izni verilmedi. Sorunuzu yazabilirsiniz."
          : "Ses algılanamadı. Yeniden deneyin veya sorunuzu yazın.",
      );
    this.active.onend = onEnd;
    this.active.start();
  }
  stop() {
    this.active?.abort();
  }
}
export interface TextToSpeechProvider {
  speak(text: string, onEnd: () => void): boolean;
  stop(): void;
}
export class BrowserTextToSpeechProvider implements TextToSpeechProvider {
  speak(text: string, onEnd: () => void) {
    if (!("speechSynthesis" in window)) return false;
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "tr-TR";
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.lang.startsWith("tr"));
    if (voice) utterance.voice = voice;
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
    window.speechSynthesis.speak(utterance);
    return true;
  }
  stop() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}
