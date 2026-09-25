"use client";

import { useEffect, useRef, useState } from "react";
import { useSpeech } from "@/components/ai/useSpeech";
import { RequestDraftCard, type RequestDraft } from "@/components/portal/RequestDraftCard";
import { speechErrors } from "@/lib/speech";

type Entry =
  | { id: number; role: "user"; text: string; voice: boolean }
  | { id: number; role: "assistant"; text: string; disclaimer: string | null; draft: RequestDraft | null; emergency: boolean };
type NewEntry = Entry extends infer Item ? (Item extends Entry ? Omit<Item, "id"> : never) : never;
type AssistantState = "ready" | "recording" | "processing" | "speaking";

const statusText: Record<AssistantState, string> = {
  ready: "Yazarak veya mikrofonla sorabilirsiniz.",
  recording: "Dinleniyor… Bitirmek için tekrar dokunun.",
  processing: "MK Pati AI yanıt hazırlıyor…",
  speaking: "Yanıt okunuyor…",
};

const examples = [
  "Boncuk'un aşıları ne zaman?",
  "Önümüzdeki hafta için randevu almak istiyorum",
  "Veterinerin verdiği şampuan bitti, yenisini istiyorum",
  "Taleplerimin durumu nedir?",
];

export function OwnerAssistant({ voiceEnabled, clinicPhone }: { voiceEnabled: boolean; clinicPhone: string | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [state, setState] = useState<AssistantState>("ready");
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState<number[]>([]);
  const speech = useSpeech();
  const conversationId = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const busy = state === "processing" || state === "recording";

  useEffect(() => () => controller.current?.abort(), []);

  function append(entry: NewEntry) {
    const id = nextId.current++;
    setEntries((current) => [...current, { ...entry, id } as Entry]);
  }

  function speak(answer: string, disclaimer: string | null) {
    setState("speaking");
    if (!speech.speak(disclaimer ? `${answer} ${disclaimer}` : answer, () => setState("ready"))) {
      setState("ready");
      setError(speechErrors.ttsUnavailable);
    }
  }

  async function send(body: BodyInit, headers: HeadersInit | undefined, userText: string | null, voice: boolean) {
    speech.stopSpeaking();
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setError("");
    setState("processing");
    if (userText) append({ role: "user", text: userText, voice });
    try {
      const response = await fetch("/api/portal/assistant", { method: "POST", headers, body, signal: request.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "MK Pati AI isteği işlenemedi.");
        setState("ready");
        return;
      }
      conversationId.current = data.conversationId ?? conversationId.current;
      if (!userText) append({ role: "user", text: data.transcript, voice });
      append({ role: "assistant", text: data.answer, disclaimer: data.disclaimer, draft: data.draft ?? null, emergency: !!data.emergency });
      if (voice) speak(data.answer, data.disclaimer);
      else setState("ready");
    } catch {
      if (!request.signal.aborted) {
        setError("Bağlantı hatası. Lütfen tekrar deneyin.");
        setState("ready");
      }
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }

  function sendText(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < 2 || busy) return;
    void send(JSON.stringify({ text: trimmed, conversationId: conversationId.current }), { "Content-Type": "application/json" }, trimmed, false);
  }

  function toggleRecording() {
    if (state === "processing") return;
    setError("");
    speech.stopSpeaking();
    if (state === "recording") {
      speech.finishRecording();
      return;
    }
    setState("recording");
    speech.record(
      (audio) => {
        const form = new FormData();
        form.append("audio", audio);
        if (conversationId.current) form.append("conversationId", conversationId.current);
        void send(form, undefined, null, true);
      },
      (message) => setError(message),
      () => setState((current) => (current === "recording" ? "ready" : current)),
    );
  }

  return (
    <section className="advisor-panel" aria-label="MK Pati AI">
      <header className="advisor-header">
        <div>
          <p className="saas-kicker">MK Pati AI</p>
          <h2>Size nasıl yardımcı olabilirim?</h2>
        </div>
        <span className="advisor-badge">Veteriner hekim değerlendirmesinin yerine geçmez</span>
      </header>
      <div className="advisor-actions">
        {examples.map((example) => (
          <button key={example} type="button" className="secondary-button" disabled={busy} onClick={() => sendText(example)}>{example}</button>
        ))}
      </div>
      <div className="advisor-log" aria-live="polite">
        {entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.id} className="advisor-message user">
              <small>{entry.voice ? "Siz · sesli" : "Siz"}</small>
              <p>{entry.text}</p>
            </div>
          ) : (
            <div key={entry.id} className={`advisor-message assistant${entry.emergency ? " emergency" : ""}`}>
              <small>MK Pati AI</small>
              <p>{entry.text}</p>
              {entry.emergency && clinicPhone && <a className="saas-primary emergency-call" href={`tel:${clinicPhone.replace(/[^\d+]/g, "")}`}>Kliniği ara</a>}
              {entry.draft && !dismissed.includes(entry.id) && (
                <RequestDraftCard draft={entry.draft} onDone={() => setDismissed((current) => [...current, entry.id])} />
              )}
              {entry.disclaimer && <p className="advisor-disclaimer">{entry.disclaimer}</p>}
              {speech.ttsSupported && (
                <div className="advisor-audio">
                  <button type="button" onClick={() => speak(entry.text, entry.disclaimer)}>▷ Dinle</button>
                  {state === "speaking" && <button type="button" onClick={() => { speech.stopSpeaking(); setState("ready"); }}>Durdur</button>}
                </div>
              )}
            </div>
          ),
        )}
        {!entries.length && (
          <p className="empty-note">
            Hayvanınızın aşı ve randevu bilgilerini sorabilir, randevu veya veteriner hekiminizin verdiği bir ilacın tekrarı için talep hazırlatabilirsiniz. Talepler klinik onayından sonra geçerlidir.
          </p>
        )}
      </div>
      <form
        className="advisor-input"
        onSubmit={(event) => {
          event.preventDefault();
          sendText(text);
          setText("");
        }}
      >
        <label className="sr-only" htmlFor="owner-question">MK Pati AI’a sorun</label>
        <input id="owner-question" value={text} onChange={(event) => setText(event.target.value)} placeholder="Mesajınızı yazın…" maxLength={2000} disabled={busy} />
        {voiceEnabled && speech.voiceSupported && (
          <button
            type="button"
            className={`advisor-mic${state === "recording" ? " recording" : ""}`}
            onClick={toggleRecording}
            disabled={state === "processing"}
            aria-label={state === "recording" ? "Kaydı bitir ve gönder" : "Sesli konuş"}
            title={state === "recording" ? "Kaydı bitir ve gönder" : "Sesli konuş"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8" />
            </svg>
          </button>
        )}
        <button className="saas-primary" disabled={busy || text.trim().length < 2}>Gönder</button>
      </form>
      <p className="advisor-status" role="status">{statusText[state]}</p>
      {error && <p className="form-message error-message" role="alert">{error}</p>}
    </section>
  );
}
