"use client";
import { useEffect, useSyncExternalStore } from "react";
import { resolveLanguage, getLocale, DEFAULT_LANGUAGE } from "@/locales";
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
const snapshot = () =>
  resolveLanguage(new URL(window.location.href).searchParams.get("lang"));
export function LocalizedNotFound() {
  const language = useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_LANGUAGE,
  );
  const t = getLocale(language).messages;
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t.errors.clinicNotFound;
  }, [language, t.errors.clinicNotFound]);
  return (
    <main className="shell">
      <h1>{t.errors.clinicNotFound}</h1>
      <p>{t.errors.clinicNotFoundDescription}</p>
    </main>
  );
}
