"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSpeech } from "@/components/ai/useSpeech";
import { speechErrors } from "@/lib/speech";

export type AdvisorAction = { intent: string; label: string };

type Candidate = { id: string; name: string; species: string; ownerName: string | null };
type ChatEntry =
  | { id: number; role: "user"; text: string; voice: boolean }
  | {
      id: number;
      role: "assistant";
      text: string;
      disclaimer: string | null;
      candidates: Candidate[];
      flagged: boolean;
    };
type NewEntry = ChatEntry extends infer Entry ? (Entry extends ChatEntry ? Omit<Entry, "id"> : never) : never;
type AdvisorState = "ready" | "recording" | "processing" | "speaking";

const statusText: Record<AdvisorState, string> = {
  ready: "Yazarak veya mikrofonla sorabilirsiniz.",
  recording: "Dinleniyor… Bitirmek için tekrar dokunun.",
  processing: "MK Pati AI kayıtları inceliyor…",
  speaking: "Yanıt okunuyor…",
};

export function ClinicAdvisor({
  businessSlug,
  patient,
  actions,
  voiceEnabled,
  placeholder,
}: {
  businessSlug: string;
  patient?: { id: string; name: string };
  actions: AdvisorAction[];
  voiceEnabled: boolean;
  placeholder: string;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [state, setState] = useState<AdvisorState>("ready");
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const speech = useSpeech();
  const { voiceSupported, ttsSupported } = speech;
  const conversationId = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const busy = state === "processing" || state === "recording";

  useEffect(() => () => controller.current?.abort(), []);

  function append(entry: NewEntry) {
    const id = nextId.current++;
    setEntries((current) => [...current, { ...entry, id } as ChatEntry]);
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
      const response = await fetch(`/api/clinics/${encodeURIComponent(businessSlug)}/advisor`, {
        method: "POST",
        headers,
        body,
        signal: request.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "MK Pati AI isteği işlenemedi.");
        setState("ready");
        return;
      }
      conversationId.current = data.conversationId ?? conversationId.current;
      setRemaining(typeof data.remainingQuota === "number" ? data.remainingQuota : null);
      if (!userText) append({ role: "user", text: data.transcript, voice });
      append({
        role: "assistant",
        text: data.answer,
        disclaimer: data.disclaimer,
        candidates: data.candidates ?? [],
        flagged: !!data.safetyFlag,
      });
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

  function sendText(value: string, intent: string | null = null, shown = value) {
    const trimmed = value.trim();
    if (trimmed.length < 2 || busy) return;
    void send(
      JSON.stringify({ text: trimmed, intent, patientId: patient?.id ?? null, conversationId: conversationId.current }),
      { "Content-Type": "application/json" },
      shown,
      false,
    );
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
        if (patient) form.append("patientId", patient.id);
        if (conversationId.current) form.append("conversationId", conversationId.current);
        void send(form, undefined, null, true);
      },
      (message) => setError(message),
      () => setState((current) => (current === "recording" ? "ready" : current)),
    );
  }

  return (
    <section className="advisor-panel" aria-label="MK Pati AI Klinik Danışmanı">
      <header className="advisor-header">
        <div>
          <p className="saas-kicker">MK Pati AI</p>
          <h2>Klinik Danışmanı{patient ? ` · ${patient.name}` : ""}</h2>
        </div>
        <span className="advisor-badge">Veteriner hekim değerlendirmesinin yerine geçmez</span>
      </header>

      <div className="advisor-actions">
        {actions.map((action) =>
          action.intent === "NOTE_CLEANUP" ? (
            <button key={action.intent} type="button" className="secondary-button" disabled={busy} onClick={() => setNote(note === null ? "" : null)}>
              {action.label}
            </button>
          ) : (
            <button key={action.intent} type="button" className="secondary-button" disabled={busy} onClick={() => sendText(action.label, action.intent)}>
              {action.label}
            </button>
          ),
        )}
      </div>

      {note !== null && (
        <form
          className="advisor-note"
          onSubmit={(event) => {
            event.preventDefault();
            sendText(note, "NOTE_CLEANUP", "Veteriner notumu düzenle.");
            setNote(null);
          }}
        >
          <label>
            Düzenlenecek not
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={5} maxLength={6000} minLength={10} required placeholder="Muayene notunuzu buraya yazın veya yapıştırın…" />
          </label>
          <button className="saas-primary" disabled={busy}>Notu düzenle</button>
        </form>
      )}

      <div className="advisor-log" aria-live="polite">
        {entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.id} className="advisor-message user">
              <small>{entry.voice ? "Siz · sesli" : "Siz"}</small>
              <p>{entry.text}</p>
            </div>
          ) : (
            <div key={entry.id} className={`advisor-message assistant${entry.flagged ? " flagged" : ""}`}>
              <small>MK Pati AI</small>
              <p>{entry.text}</p>
              {!!entry.candidates.length && (
                <ul className="advisor-candidates">
                  {entry.candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <Link href={`/app/${businessSlug}/patients/${candidate.id}`}>
                        {candidate.name} · {candidate.species}
                        {candidate.ownerName ? ` · ${candidate.ownerName}` : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {entry.disclaimer && <p className="advisor-disclaimer">{entry.disclaimer}</p>}
              {ttsSupported && (
                <div className="advisor-audio">
                  <button type="button" onClick={() => speak(entry.text, entry.disclaimer)}>▷ Dinle</button>
                  {state === "speaking" && (
                    <button type="button" onClick={() => { speech.stopSpeaking(); setState("ready"); }}>Durdur</button>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        {!entries.length && <p className="empty-note">{placeholder}</p>}
      </div>

      <form
        className="advisor-input"
        onSubmit={(event) => {
          event.preventDefault();
          sendText(text);
          setText("");
        }}
      >
        <label className="sr-only" htmlFor={`advisor-question-${patient?.id ?? "clinic"}`}>MK Pati AI’a sorun</label>
        <input
          id={`advisor-question-${patient?.id ?? "clinic"}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={patient ? `${patient.name} hakkında sorun…` : "Örn. Bugün hangi hastaların randevusu var?"}
          maxLength={2000}
          disabled={busy}
        />
        {voiceEnabled && voiceSupported && (
          <button
            type="button"
            className={`advisor-mic${state === "recording" ? " recording" : ""}`}
            onClick={toggleRecording}
            disabled={state === "processing"}
            aria-label={state === "recording" ? "Kaydı bitir ve gönder" : "Sesli sor"}
            title={state === "recording" ? "Kaydı bitir ve gönder" : "Sesli sor"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8" />
            </svg>
          </button>
        )}
        <button className="saas-primary" disabled={busy || text.trim().length < 2}>Gönder</button>
      </form>
      <p className="advisor-status" role="status">
        {statusText[state]}
        {remaining !== null ? ` · Bu ay kalan AI isteği: ${remaining}` : ""}
      </p>
      {error && <p className="form-message error-message" role="alert">{error}</p>}
    </section>
  );
}
