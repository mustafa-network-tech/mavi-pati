"use client";
import { useEffect, useRef, useState } from "react";
import type { Clinic } from "@/types";
import {
  BrowserSpeechRecognitionProvider,
  BrowserTextToSpeechProvider,
} from "@/lib/speech";
const examples = [
  "Kedi karma aşısı ne kadar?",
  "Kedi kısırlaştırma ücreti nedir?",
  "Bugün kaça kadar açıksınız?",
  "Mikroçip uygulaması yapıyor musunuz?",
  "Randevu almam gerekiyor mu?",
  "Acil hizmetiniz var mı?",
];
export function Assistant({
  clinic,
  preview = false,
}: {
  clinic: Clinic;
  preview?: boolean;
}) {
  const [text, setText] = useState(""),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(""),
    [unanswered, setUnanswered] = useState(false),
    [state, setState] = useState("Hazır"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [url, setUrl] = useState<string | null>(null);
  const stt = useRef<BrowserSpeechRecognitionProvider | null>(null),
    tts = useRef<BrowserTextToSpeechProvider | null>(null),
    busy = useRef(false);
  useEffect(() => {
    stt.current = new BrowserSpeechRecognitionProvider();
    tts.current = new BrowserTextToSpeechProvider();
    return () => {
      stt.current?.stop();
      tts.current?.stop();
    };
  }, []);
  function speak(value: string) {
    setState("Konuşuyor...");
    if (!tts.current?.speak(value, () => setState("Cevap hazır")))
      setState("Cevap hazır");
  }
  async function ask(value: string) {
    if (busy.current || saving) return;
    busy.current = true;
    tts.current?.stop();
    stt.current?.stop();
    setError("");
    setQuestion(value);
    setAnswer("");
    setSaved(false);
    setUrl(null);
    setUnanswered(false);
    setState("Sorunuz anlaşılıyor...");
    try {
      const res = await fetch(
        `/api/${encodeURIComponent(clinic.slug)}/question`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: value }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        setState("Hazır");
        return;
      }
      setAnswer(data.answer);
      setUnanswered(!data.answered);
      speak(data.answer);
    } catch {
      setError("İnternet bağlantınızı kontrol edip tekrar deneyin.");
      setState("Hazır");
    } finally {
      busy.current = false;
    }
  }
  function listen() {
    if (busy.current || saving) return;
    setError("");
    tts.current?.stop();
    if (state === "Dinliyor...") {
      stt.current?.stop();
      setState("Hazır");
      return;
    }
    setState("Dinliyor...");
    try {
      stt.current?.start(
        (value) => {
          setText(value);
          void ask(value);
        },
        (message) => {
          setError(message);
          setState("Hazır");
        },
        () => setState((s) => (s === "Dinliyor..." ? "Hazır" : s)),
      );
    } catch {
      setError("Mikrofon başlatılamadı. Sorunuzu yazabilirsiniz.");
      setState("Hazır");
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || saved) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/${encodeURIComponent(clinic.slug)}/unanswered`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            visitor_name: form.get("visitor_name"),
            visitor_phone: form.get("visitor_phone"),
            consent: form.get("consent") === "on",
            website: form.get("website"),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setSaved(true);
      setUrl(data.whatsappUrl);
    } catch {
      setError(
        "Sorunuz kaydedilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="shell">
      {preview && (
        <p className="preview" role="status">
          Mock klinik modu · Örnek bilgiler kullanılıyor. Soru kayıtları
          geçicidir; sunucu yeniden başladığında silinir. Kliniğe otomatik
          bildirim gönderilmez.
        </p>
      )}
      <header>
        <a className="brand" href={`/${clinic.slug}`}>
          <span className="paw">✦</span>
          <span>
            {clinic.name}
            <small>SESLİ ASİSTAN</small>
          </span>
        </a>
        <span className="demo">Demo klinik</span>
      </header>
      <section className="hero">
        <span className="eyebrow">DOSTLARIMIZ İÇİN BURADAYIZ</span>
        <h1>
          Merhaba 👋
          <br />
          Size nasıl yardımcı
          <br />
          olabilirim?
        </h1>
        <p>
          Kliniğimiz hakkında merak ettiklerinizi sorun.
          <br />
          Siz konuşun, asistanımız cevaplasın.
        </p>
        <button
          className={`mic ${state === "Dinliyor..." ? "listening" : ""}`}
          aria-label={
            state === "Dinliyor..." ? "Dinlemeyi durdur" : "Mikrofonla soru sor"
          }
          disabled={saving || state === "Sorunuz anlaşılıyor..."}
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
          {state}
        </p>
        <form
          className="question-input"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <label className="sr-only" htmlFor="question">
            Sorunuzu yazarak sorun
          </label>
          <input
            id="question"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Sorunuzu yazarak da sorabilirsiniz"
            minLength={3}
            maxLength={1000}
            required
          />
          <button
            disabled={saving || state === "Sorunuz anlaşılıyor..."}
            aria-label="Soruyu gönder"
          >
            ↗
          </button>
        </form>
      </section>
      <section className="examples">
        <h2>Bir soruyla başlayın</h2>
        <div>
          {examples.map((q) => (
            <button
              key={q}
              disabled={saving || state === "Sorunuz anlaşılıyor..."}
              onClick={() => {
                setText(q);
                void ask(q);
              }}
            >
              {q}
              <span>↗</span>
            </button>
          ))}
        </div>
      </section>
      {question && (
        <section className="conversation">
          <small>SİZİN SORUNUZ</small>
          <p>{question}</p>
          {answer && (
            <>
              <small>ASİSTANINIZ</small>
              <p className="answer">{answer}</p>
              <div className="audio">
                <button onClick={() => speak(answer)}>
                  ▷ Cevabı tekrar dinle
                </button>
                <button
                  onClick={() => {
                    tts.current?.stop();
                    setState("Cevap hazır");
                  }}
                >
                  Sesi durdur
                </button>
              </div>
            </>
          )}
          {unanswered && !saved && (
            <form className="contact" onSubmit={submit}>
              <h2>Size ulaşabilmemiz için</h2>
              <p>
                {preview
                  ? "Akışı denemek için örnek ad ve telefon bilgileri kullanabilirsiniz."
                  : "Adınızı ve telefon numaranızı bırakın."}
              </p>
              <label>
                Ad Soyad
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
                Telefon
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
                <span>
                  {preview
                    ? "Adım, telefon numaram ve sorumun bu demo için geçici olarak tutulmasını onaylıyorum. WhatsApp butonunu kullanırsam bu bilgiler demo kliniğinin WhatsApp görüşmesine aktarılacaktır."
                    : "Adım, telefon numaram ve sorumun, soruma dönüş yapılması amacıyla klinikle paylaşılmasını onaylıyorum. WhatsApp butonunu kullanırsam bu bilgiler WhatsApp üzerinden de paylaşılacaktır."}
                </span>
              </label>
              <button className="primary" disabled={saving}>
                {saving
                  ? "Kaydediliyor..."
                  : preview
                    ? "Demo soruyu kaydet"
                    : "Sorumu kliniğe ilet"}
              </button>
            </form>
          )}
          {saved && (
            <div className="success" role="status">
              <strong>
                {preview
                  ? "✓ Demo soru kaydı oluşturuldu."
                  : "✓ Sorunuz kliniğe iletildi."}
              </strong>
              {url && (
                <>
                  <a
                    className="primary"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp ile Kliniğe İlet
                  </a>
                  <small>
                    Hazır mesaj WhatsApp’ta açılır. Göndermek için WhatsApp
                    üzerinden onaylayın.
                  </small>
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
        <p>
          Temsili demo bilgileri kullanılır. Tıbbi değerlendirme için veteriner
          hekiminize başvurun.
        </p>
        <span>MK DIGITAL SYSTEMS</span>
      </footer>
    </main>
  );
}
