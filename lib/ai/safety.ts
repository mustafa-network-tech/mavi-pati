// Code-level enforcement of CLINIC_ADVISOR_POLICY. Model output is never trusted as-is.
// A dose or a definitive-diagnosis phrase is only allowed when it is copied from the
// grounding text (the clinic's own records or the note the veterinarian wrote).

const dosePattern =
  /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|g|ml|cc|iu|ü|ünite|unite|tablet|tb|kapsül|damla|ampul|puf)(?:\s*\/\s*(?:kg|gün|doz))?(?![a-zçğıöşü])/giu;
const diagnosisPattern =
  /kesin(?:likle)?\s+(?:teşhis|tanı)|(?:teşhis|tanı)(?:si|sı|i|ı)?\s*(?:kesin|şudur|budur)|kesinlikle\s+\p{L}+\s+(?:hastalığı|hastalığıdır|enfeksiyonu|enfeksiyonudur)/giu;
const prescribingPattern =
  /reçete\s+(?:ediyorum|ediyoruz|yazıyorum|yazıyoruz|edilmelidir|öneriyorum)|(?:ilacını|ilacı)\s+(?:verin|kullanın|başlayın)|(?:doz|dozu)\s+(?:olarak|şu şekilde)\s+(?:verin|uygulayın)/giu;

export type SafetyViolation = "UNGROUNDED_DOSE" | "DEFINITIVE_DIAGNOSIS" | "PRESCRIPTION";

const normalize = (text: string) => text.toLocaleLowerCase("tr-TR").replace(/\s+/g, "").replace(/,/g, ".");

export function findClinicalSafetyViolation(answer: string, groundingText: string): SafetyViolation | null {
  const grounding = normalize(groundingText);
  const ungrounded = (pattern: RegExp) =>
    [...answer.matchAll(pattern)].some(([match]) => !grounding.includes(normalize(match)));
  if (ungrounded(dosePattern)) return "UNGROUNDED_DOSE";
  if (ungrounded(diagnosisPattern)) return "DEFINITIVE_DIAGNOSIS";
  if (ungrounded(prescribingPattern)) return "PRESCRIPTION";
  return null;
}

export const SAFETY_FALLBACK_ANSWER =
  "Bu yanıt güvenlik kuralları nedeniyle gösterilmedi: MK Pati AI ilaç/doz önerisi, reçete veya kesin teşhis üretemez. İsteğinizi kayıt özeti olarak yeniden ifade edebilir veya veteriner hekim değerlendirmesine başvurabilirsiniz.";
