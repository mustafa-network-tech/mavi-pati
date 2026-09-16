import { notFound } from "next/navigation";
import { getClinic } from "@/lib/clinics";
import { Assistant } from "@/components/assistant/Assistant";
import { isLocalDemo } from "@/lib/demo/mode";
import {
  resolveLanguage,
  getLocale,
  getClinicLanguages,
  isLanguageCode,
} from "@/locales";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{
    clinicSlug: string;
  }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { clinicSlug } = await params;
  const queryLanguage = (await searchParams).lang;
  const requestedLanguage = resolveLanguage(queryLanguage);
  const t = getLocale(requestedLanguage).messages;
  let clinic;
  try {
    clinic = await getClinic(clinicSlug);
  } catch {
    return (
      <main>
        <p>{t.errors.clinicUnavailable}</p>
      </main>
    );
  }
  if (!clinic) notFound();
  const { supported, defaultLanguage } = getClinicLanguages(clinic);
  const language =
    isLanguageCode(queryLanguage) && supported.includes(requestedLanguage)
      ? requestedLanguage
      : defaultLanguage;
  return (
    <Assistant
      key={language}
      clinic={clinic}
      preview={isLocalDemo()}
      initialLanguage={language}
    />
  );
}
