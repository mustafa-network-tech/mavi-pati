import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrowserSpeechRecognitionProvider,
  BrowserTextToSpeechProvider,
  type Recognition,
} from "../lib/speech";
import { getLocale } from "../locales";
function installGlobals(values: Record<string, unknown>) {
  const original = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  return () => {
    for (const [key, descriptor] of original)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  };
}
class FakeRecognition implements Recognition {
  static latest: FakeRecognition;
  lang = "";
  continuous = true;
  interimResults = true;
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  aborted = false;
  constructor() {
    FakeRecognition.latest = this;
  }
  start() {}
  abort() {
    this.aborted = true;
  }
}
test("speech recognition preserves Turkish default and transcribes with ru-RU after selection", (t) => {
  t.after(installGlobals({ window: { SpeechRecognition: FakeRecognition } }));
  const provider = new BrowserSpeechRecognitionProvider();
  assert.equal(provider.supported(), true);
  provider.start(
    () => {},
    () => {},
    () => {},
  );
  const old = FakeRecognition.latest;
  assert.equal(old.lang, "tr-TR");
  let transcript = "";
  provider.start(
    (text) => {
      transcript = text;
    },
    () => {},
    () => {},
    "ru",
  );
  const active = FakeRecognition.latest;
  assert.equal(old.aborted, true);
  assert.equal(old.onresult, null);
  assert.equal(active.lang, "ru-RU");
  assert.equal(active.continuous, false);
  assert.equal(active.interimResults, false);
  active.onresult?.({
    results: {
      0: { 0: { transcript: "Сколько стоит комплексная вакцина для кошки?" } },
    },
  });
  assert.match(transcript, /Сколько/);
  provider.stop();
  assert.equal(active.onresult, null);
  assert.equal(active.onend, null);
});
test("Russian speech errors and unsupported browser fallback are localized", (t) => {
  t.after(installGlobals({ window: { SpeechRecognition: FakeRecognition } }));
  let error = "";
  const provider = new BrowserSpeechRecognitionProvider();
  provider.start(
    () => {},
    (message) => {
      error = message;
    },
    () => {},
    "ru",
  );
  FakeRecognition.latest.onerror?.({ error: "not-allowed" });
  assert.equal(error, getLocale("ru").messages.errors.microphoneDenied);
  provider.stop();
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  assert.equal(provider.supported(), false);
  provider.start(
    () => {},
    (message) => {
      error = message;
    },
    () => {},
    "ru",
  );
  assert.equal(error, getLocale("ru").messages.errors.speechUnsupported);
});
class FakeUtterance {
  lang = "";
  voice: { lang: string } | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
test("TTS selects voices for each language and prevents cancelled speech callbacks", (t) => {
  const utterances: FakeUtterance[] = [];
  let cancellations = 0;
  let finished = false;
  const voices = [{ lang: "tr-TR" }, { lang: "ru-RU" }];
  t.after(
    installGlobals({
      SpeechSynthesisUtterance: FakeUtterance,
      window: {
        speechSynthesis: {
          getVoices: () => voices,
          speak: (value: FakeUtterance) => utterances.push(value),
          cancel: () => {
            cancellations++;
          },
        },
      },
    }),
  );
  const provider = new BrowserTextToSpeechProvider();
  assert.equal(
    provider.speak("Türkçe cevap", () => {
      finished = true;
    }),
    true,
  );
  assert.equal(utterances[0].lang, "tr-TR");
  assert.equal(utterances[0].voice?.lang, "tr-TR");
  provider.speak(
    "Русский ответ",
    () => {
      finished = true;
    },
    "ru",
  );
  assert.equal(utterances[0].onend, null);
  assert.equal(utterances[1].lang, "ru-RU");
  assert.equal(utterances[1].voice?.lang, "ru-RU");
  assert.equal(finished, false);
  utterances[1].onend?.();
  assert.equal(finished, true);
  assert.ok(cancellations >= 2);
});
test("missing Russian voice or TTS support does not crash", (t) => {
  let last: FakeUtterance | undefined;
  t.after(
    installGlobals({
      SpeechSynthesisUtterance: FakeUtterance,
      window: {
        speechSynthesis: {
          getVoices: () => [],
          speak: (value: FakeUtterance) => {
            last = value;
          },
          cancel: () => {},
        },
      },
    }),
  );
  const provider = new BrowserTextToSpeechProvider();
  assert.equal(
    provider.speak("Ответ остаётся на экране", () => {}, "ru"),
    true,
  );
  assert.equal(last?.lang, "ru-RU");
  assert.equal(last?.voice, null);
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  assert.equal(
    provider.speak("Ответ", () => {}, "ru"),
    false,
  );
});
