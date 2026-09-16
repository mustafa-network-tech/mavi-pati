"use client";
import { useEffect, useRef, useState } from "react";
import type { Clinic } from "@/types";
import {
  BrowserSpeechRecognitionProvider,
  BrowserTextToSpeechProvider,
} from "@/lib/speech";
import {
  DEFAULT_LANGUAGE,
  getLocale,
  getClinicLanguages,
  type LanguageCode,
} from "@/locales";
type AssistantState =
  "ready" | "listening" | "processing" | "answered" | "speaking";
export function Assistant({
  clinic,
  preview = false,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  clinic: Clinic;
  preview?: boolean;
  initialLanguage?: LanguageCode;
}) {
  const [language, setLanguage] = useState<LanguageCode>(initialLanguage);
  const locale = getLocale(language),
    t = locale.messages;
  const clinicLanguages = getClinicLanguages(clinic);
  const clinicName = clinic.name_translations?.[language] ?? clinic.name;
  const [text, setText] = useState(""),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(""),
    [unanswered, setUnanswered] = useState(false),
    [state, setState] = useState<AssistantState>("ready"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [url, setUrl] = useState<string | null>(null);
  const stt = useRef<BrowserSpeechRecognitionProvider | null>(null),
    tts = useRef<BrowserTextToSpeechProvider | null>(null),
    busy = useRef(false),
    savingRef = useRef(false),
    session = useRef(0),
    requestController = useRef<AbortController | null>(null);
  useEffect(() => {
    const sessionRef = session,
      controllerRef = requestController;
    const recognition = new BrowserSpeechRecognitionProvider(),
      synthesis = new BrowserTextToSpeechProvider();
    stt.current = recognition;
    tts.current = synthesis;
    return () => {
      sessionRef.current++;
      controllerRef.current?.abort();
      recognition.stop();
      synthesis.stop();
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = locale.direction;
    document.title = `${clinicName} · ${t.assistantTitle}`;
  }, [language, locale.direction, clinicName, t.assistantTitle]);
  function changeLanguage(next: LanguageCode) {
    if (next === language || savingRef.current) return;
    session.current++;
    requestController.current?.abort();
    stt.current?.stop();
    tts.current?.stop();
    busy.current = false;
    setLanguage(next);
    setText("");
    setQuestion("");
    setAnswer("");
    setUnanswered(false);
    setState("ready");
    setError("");
    setSaved(false);
    setUrl(null);
    const location = new URL(window.location.href);
    location.searchParams.set("lang", next);
    window.history.replaceState(null, "", location);
  }
  function speak(value: string) {
    const version = session.current;
    setState("speaking");
    if (
      !tts.current?.speak(
        value,
        () => {
          if (version === session.current) setState("answered");
        },
        language,
      )
    ) {
      setState("answered");
      setError(t.errors.ttsUnavailable);
    }
  }
  async function ask(value: string) {
    if (busy.current || savingRef.current) return;
    busy.current = true;
    const version = session.current;
    const controller = new AbortController();
    requestController.current = controller;
    tts.current?.stop();
    stt.current?.stop();
    setError("");
    setQuestion(value);
    setAnswer("");
    setSaved(false);
    setUrl(null);
    setUnanswered(false);
    setState("processing");
    try {
      const response = await fetch(
        `/api/${encodeURIComponent(clinic.slug)}/question`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Assistant-Language": language,
          },
          body: JSON.stringify({ question: value, language_code: language }),
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (version !== session.current) return;
      if (!response.ok) {
        setError(data.error ?? t.errors.unavailable);
        setState("ready");
        return;
      }
      setAnswer(data.answer);
      setUnanswered(!data.answered);
      speak(data.answer);
    } catch {
      if (version === session.current && !controller.signal.aborted) {
        setError(t.errors.network);
        setState("ready");
      }
    } finally {
      if (version === session.current) {
        busy.current = false;
        requestController.current = null;
      }
    }
  }
  function listen() {
    if (busy.current || savingRef.current) return;
    setError("");
    tts.current?.stop();
    if (state === "listening") {
      stt.current?.stop();
      setState("ready");
      return;
    }
    const version = session.current;
    setState("listening");
    stt.current?.start(
      (value) => {
        if (version === session.current) {
          setText(value);
          void ask(value);
        }
      },
      (message) => {
        if (version === session.current) {
          setError(message);
          setState("ready");
        }
      },
      () => {
        if (version === session.current)
          setState((current) => (current === "listening" ? "ready" : current));
      },
      language,
    );
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || saved) return;
    const form = new FormData(event.currentTarget);
    savingRef.current = true;
    setSaving(true);
    setError("");
    const version = session.current;
    try {
      const response = await fetch(
        `/api/${encodeURIComponent(clinic.slug)}/unanswered`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Assistant-Language": language,
          },
          body: JSON.stringify({
            question,
            language_code: language,
            visitor_name: form.get("visitor_name"),
            visitor_phone: form.get("visitor_phone"),
            consent: form.get("consent") === "on",
            website: form.get("website"),
          }),
        },
      );
      const data = await response.json();
      if (version !== session.current) return;
      if (!response.ok) {
        setError(data.error ?? t.errors.saveFailed);
        return;
      }
      setSaved(true);
      setUrl(data.whatsappUrl);
    } catch {
      if (version === session.current) setError(t.errors.saveNetwork);
    } finally {
      savingRef.current = false;
      if (version === session.current) setSaving(false);
    }
  }
  return (
    <main className="shell">
      {preview && (
        <p className="preview" role="status">
          {t.mockNotice}
        </p>
      )}
      <header>
        <a className="brand" href={`/${clinic.slug}?lang=${language}`}>
          <span className="paw" aria-hidden="true">
            ✦
          </span>
          <span>
            {clinicName}
            <small>{t.assistantTitle}</small>
          </span>
        </a>
        <div className="header-controls">
          <span className="demo">{t.demoClinic}</span>
          <div
            className="language-switch"
            role="group"
            aria-label={t.languageLabel}
          >
            {clinicLanguages.supported.map((code) => (
              <button
                key={code}
                type="button"
                lang={code}
                aria-pressed={language === code}
                aria-label={getLocale(code).label}
                disabled={saving}
                onClick={() => changeLanguage(code)}
              >
                {getLocale(code).shortLabel}
              </button>
            ))}
          </div>
        </div>
      </header>
      <section className="hero">
        <span className="eyebrow">{t.eyebrow}</span>
        <h1>
          {t.greeting}
          <br />
          {t.heroTitle}
        </h1>
        <p className="multiline">{t.heroDescription}</p>
        <button
          className={`mic ${state === "listening" ? "listening" : ""}`}
          aria-label={
            state === "listening" ? t.stopListening : t.microphoneLabel
          }
          disabled={saving || state === "processing"}
          onClick={listen}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8" />
          </svg>
        </button>
        <p className="status" role="status">
          {t.statuses[state]}
        </p>
        <small className="mic-hint">{t.tapToSpeak}</small>
        <form
          className="question-input"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(text);
          }}
        >
          <label className="sr-only" htmlFor="question">
            {t.textQuestionLabel}
          </label>
          <input
            id="question"
            lang={language}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t.textPlaceholder}
            minLength={3}
            maxLength={1000}
            required
          />
          <button
            disabled={saving || state === "processing"}
            aria-label={t.sendQuestion}
          >
            ↗
          </button>
        </form>
      </section>
      <section className="examples">
        <h2>{t.examplesTitle}</h2>
        <div>
          {t.examples.map((example) => (
            <button
              key={example}
              disabled={saving || state === "processing"}
              onClick={() => {
                setText(example);
                void ask(example);
              }}
            >
              {example}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </section>
      {question && (
        <section className="conversation">
          <small>{t.yourQuestion}</small>
          <p>{question}</p>
          {answer && (
            <>
              <small>{t.yourAssistant}</small>
              <p className="answer">{answer}</p>
              <div className="audio">
                <button onClick={() => speak(answer)}>▷ {t.listenAgain}</button>
                <button
                  onClick={() => {
                    tts.current?.stop();
                    setState("answered");
                  }}
                >
                  {t.stopAudio}
                </button>
              </div>
            </>
          )}
          {unanswered && !saved && (
            <form key={language} className="contact" onSubmit={submit}>
              <h2>{t.contactTitle}</h2>
              <p>{preview ? t.mockContactDescription : t.contactDescription}</p>
              <label>
                {t.visitorName}
                <input
                  name="visitor_name"
                  autoComplete="name"
                  minLength={3}
                  maxLength={100}
                  required
                  disabled={saving}
                />
              </label>
              <label>
                {t.visitorPhone}
                <input
                  name="visitor_phone"
                  type="tel"
                  autoComplete="tel"
                  minLength={10}
                  maxLength={22}
                  required
                  disabled={saving}
                />
              </label>
              <input
                className="honeypot"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />
              <label className="consent">
                <input
                  name="consent"
                  type="checkbox"
                  required
                  disabled={saving}
                />
                <span>{preview ? t.mockConsent : t.consent}</span>
              </label>
              <button className="primary" disabled={saving}>
                {saving ? t.saving : preview ? t.saveMock : t.saveQuestion}
              </button>
            </form>
          )}
          {saved && (
            <div className="success" role="status">
              <strong>{preview ? t.savedMock : t.savedQuestion}</strong>
              {url && (
                <>
                  <a
                    className="primary"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.whatsappButton}
                  </a>
                  <small>{t.whatsappHelp}</small>
                </>
              )}
            </div>
          )}
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <p>{t.footer}</p>
        <span>MK DIGITAL SYSTEMS</span>
      </footer>
    </main>
  );
}
