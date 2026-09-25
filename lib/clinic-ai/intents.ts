import type { AdvisorIntent } from "@/lib/ai/schemas";

type IntentDefinition = {
  label: string;
  description: string;
  // Examinations/treatments are needed: CLINIC_STAFF is not allowed (RLS hides them too).
  clinical: boolean;
  adminOnly?: boolean;
  needsPatient: boolean;
  disclaimer: "CLINICAL" | "DRAFT" | null;
  task: string;
};

export const advisorIntents: Record<Exclude<AdvisorIntent, "OUT_OF_SCOPE">, IntentDefinition> = {
  PATIENT_HISTORY: {
    label: "Hasta geçmişini özetle",
    description: "Bir hastanın genel geçmişinin özeti (muayene, tedavi, aşı).",
    clinical: true,
    needsPatient: true,
    disclaimer: "CLINICAL",
    task: "Hastanın kayıtlı geçmişini kronolojik ve öz biçimde özetle: başvuru nedenleri, önemli bulgular, veteriner değerlendirmeleri, yapılan işlemler, aşı durumu ve açık kontroller. Yeni yorum ekleme.",
  },
  RECENT_EXAMINATIONS: {
    label: "Son muayeneleri özetle",
    description: "Bir hastanın son muayenelerinin özeti.",
    clinical: true,
    needsPatient: true,
    disclaimer: "CLINICAL",
    task: "Hastanın son muayenelerini tarih sırasıyla özetle: başvuru nedeni, bulgular, veteriner değerlendirmesi, yapılan işlemler ve kontrol tarihi.",
  },
  VACCINATION_SUMMARY: {
    label: "Kontrol / aşı geçmişini özetle",
    description: "Bir hastanın aşı geçmişi, yaklaşan/geciken aşılar ve planlanan kontroller.",
    clinical: false,
    needsPatient: true,
    disclaimer: "CLINICAL",
    task: "Hastanın aşı kayıtlarını ve (varsa) planlanan kontrol tarihlerini özetle. ŞİMDİ tarihine göre gecikmiş ve 30 gün içinde yaklaşan olanları ayrıca belirt. Aşı önerisi yapma.",
  },
  NOTE_CLEANUP: {
    label: "Veteriner notunu düzenle",
    description: "Veteriner hekimin yazdığı serbest notu düzenli hale getirme.",
    clinical: true,
    needsPatient: false,
    disclaimer: "DRAFT",
    task: "BAĞLAM.not metnini anlamını, tıbbi içeriğini ve değerlerini DEĞİŞTİRMEDEN; yazım ve düzen açısından iyileştir. Uygunsa 'Anamnez / Bulgular / Değerlendirme / Yapılanlar / Plan' başlıklarını yalnızca notta karşılığı olanlar için kullan. Not metninde olmayan hiçbir bilgi, teşhis, ilaç veya doz ekleme.",
  },
  OWNER_INFO_DRAFT: {
    label: "Hayvan sahibi için bilgilendirme taslağı",
    description: "Son muayene kaydından hayvan sahibine anlaşılır bilgilendirme metni taslağı.",
    clinical: true,
    needsPatient: true,
    disclaimer: "DRAFT",
    task: "Son muayene ve işlem kayıtlarından hayvan sahibine yönelik, tıbbi terimleri sadeleştiren, nazik bir bilgilendirme TASLAĞI yaz. Yalnızca veteriner hekimin kayda geçirdiği bulgu, değerlendirme, yapılan işlem ve kontrol tarihini aktar. Kayıtta olmayan tedavi, ilaç veya doz önerisi ekleme. Sonunda soruları için kliniğe başvurabileceklerini belirt.",
  },
  TODAY_APPOINTMENTS: {
    label: "Bugünkü randevular",
    description: "Kliniğin bugünkü randevuları.",
    clinical: false,
    needsPatient: false,
    disclaimer: null,
    task: "Bugünkü randevuları saat sırasıyla listele: saat, hasta, veteriner hekim, durum ve kısa açıklama. Sonunda toplamı ve durum dağılımını belirt.",
  },
  UPCOMING_VACCINATIONS: {
    label: "Yaklaşan aşılar",
    description: "Kliniğin yaklaşan ve geciken aşıları.",
    clinical: false,
    needsPatient: false,
    disclaimer: null,
    task: "Gecikmiş aşıları ve önümüzdeki 30 gün içinde yaklaşan aşıları tarih sırasıyla listele: hasta, aşı, tarih. Önce gecikmişleri ver.",
  },
  UPCOMING_FOLLOW_UPS: {
    label: "Yaklaşan kontroller",
    description: "Muayenelerde planlanan yaklaşan kontrol tarihleri.",
    clinical: true,
    needsPatient: false,
    disclaimer: null,
    task: "Önümüzdeki 14 gün içinde planlanmış kontrolleri tarih sırasıyla listele: hasta, kontrol tarihi, ilgili muayenenin başvuru nedeni ve veteriner hekim.",
  },
  OPERATIONS_SUMMARY: {
    label: "Operasyon özeti",
    description: "Klinik yöneticisi için günlük/haftalık operasyon özeti.",
    clinical: true,
    adminOnly: true,
    needsPatient: false,
    disclaimer: null,
    task: "Klinik yöneticisine kısa bir operasyon özeti hazırla: bugünkü ve bu haftaki randevu yükü ve veteriner hekim dağılımı, son 7 gündeki yeni hasta/muayene/işlem sayıları, yaklaşan ve geciken aşılar. Sayıları BAĞLAM'daki gibi kullan; dikkat çeken noktaları belirt.",
  },
};

export type ConcreteIntent = keyof typeof advisorIntents;

export function isIntentAllowed(intent: ConcreteIntent, role: string) {
  const definition = advisorIntents[intent];
  if (definition.adminOnly) return role === "CLINIC_ADMIN";
  if (definition.clinical) return role === "CLINIC_ADMIN" || role === "VETERINARIAN";
  return role === "CLINIC_ADMIN" || role === "VETERINARIAN" || role === "CLINIC_STAFF";
}

export function allowedIntents(role: string) {
  return (Object.keys(advisorIntents) as ConcreteIntent[]).filter((intent) => isIntentAllowed(intent, role));
}

export const OUT_OF_SCOPE_ANSWER =
  "Bu isteğe yardımcı olamıyorum. MK Pati AI; hasta geçmişi, muayene, aşı ve randevu kayıtlarını özetleyebilir, veteriner notlarını düzenleyebilir ve bilgilendirme taslağı hazırlayabilir. Teşhis, reçete, ilaç/doz ve tedavi kararları veteriner hekime aittir.";

export function notAllowedAnswer(intent: ConcreteIntent) {
  return advisorIntents[intent].adminOnly
    ? "Operasyon özeti yalnızca klinik yöneticisi tarafından kullanılabilir."
    : "Bu işlem muayene ve tedavi kayıtlarına erişim gerektirir; rolünüz bu kayıtlara erişemez.";
}
