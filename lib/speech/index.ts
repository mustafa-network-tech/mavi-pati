// In-app voice for MK Pati AI (browser side). Restored from the earlier voice
// assistant (lib/speech, removed in bd8c09d) and adapted:
// - Speech-to-text: the microphone is recorded locally and transcribed on OUR server
//   through the existing OpenAI integration (no third-party browser speech service).
// - Text-to-speech: the browser's speechSynthesis, as before.
// This is in-app conversation only; there is no telephony of any kind.

export const SPEECH_LOCALE = "tr-TR";
export const MAX_RECORDING_MS = 60_000;

export const speechErrors = {
  unsupported: "Tarayıcınız mikrofon kaydını desteklemiyor. Lütfen yazarak sorun.",
  microphoneDenied: "Mikrofon izni verilmedi. Tarayıcı ayarlarından mikrofona izin verin.",
  microphoneFailed: "Mikrofon başlatılamadı. Lütfen tekrar deneyin.",
  noSpeech: "Ses algılanmadı. Lütfen tekrar deneyin.",
  ttsUnavailable: "Bu tarayıcı sesli okumayı desteklemiyor; yanıtı ekrandan okuyabilirsiniz.",
} as const;

export interface VoiceRecorder {
  supported(): boolean;
  start(onAudio: (audio: Blob) => void, onError: (message: string) => void, onEnd: () => void): Promise<void>;
  stop(): void;
  cancel(): void;
}

const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export class BrowserVoiceRecorder implements VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Per recording, so a late "stop" event of a discarded recording is never delivered.
  private session: { canceled: boolean } | null = null;
  private starting: object | null = null;

  supported() {
    return (
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  async start(onAudio: (audio: Blob) => void, onError: (message: string) => void, onEnd: () => void) {
    this.cancel();
    if (!this.supported()) {
      onError(speechErrors.unsupported);
      onEnd();
      return;
    }
    const attempt = {};
    this.starting = attempt;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.starting !== attempt) {
        // Canceled (e.g. the panel closed) while the permission prompt was open.
        stream.getTracks().forEach((track) => track.stop());
        onEnd();
        return;
      }
      this.stream = stream;
    } catch (error) {
      onError(
        error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
          ? speechErrors.microphoneDenied
          : speechErrors.microphoneFailed,
      );
      onEnd();
      return;
    }
    const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const session = { canceled: false };
    this.recorder = recorder;
    this.session = session;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (this.recorder === recorder) this.release();
      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (!session.canceled) {
        if (audio.size < 1000) onError(speechErrors.noSpeech);
        else onAudio(audio);
      }
      onEnd();
    };
    recorder.onerror = () => {
      session.canceled = true;
      onError(speechErrors.microphoneFailed);
      try {
        recorder.stop();
      } catch {
        this.release();
        onEnd();
      }
    };
    try {
      recorder.start();
      this.timer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
    } catch {
      this.release();
      onError(speechErrors.microphoneFailed);
      onEnd();
    }
  }

  // Finishes the recording and delivers the audio.
  stop() {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  // Discards the recording.
  cancel() {
    this.starting = null;
    if (this.session) this.session.canceled = true;
    this.stop();
    this.release();
  }

  private release() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.session = null;
  }
}

export interface TextToSpeechProvider {
  supported(): boolean;
  speak(text: string, onEnd: () => void): boolean;
  stop(): void;
}

export class BrowserTextToSpeechProvider implements TextToSpeechProvider {
  private active: SpeechSynthesisUtterance | null = null;

  supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  speak(text: string, onEnd: () => void) {
    if (!this.supported()) return false;
    this.stop();
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      this.active = utterance;
      utterance.lang = SPEECH_LOCALE;
      const voices = window.speechSynthesis.getVoices();
      const voice =
        voices.find((candidate) => candidate.lang.toLowerCase() === SPEECH_LOCALE.toLowerCase()) ??
        voices.find((candidate) => candidate.lang.toLowerCase().startsWith("tr"));
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
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}

// Spoken text: strip list markers and markdown so answers read naturally.
export function toSpeakableText(text: string) {
  return text
    .replace(/[*_#`>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .trim();
}
