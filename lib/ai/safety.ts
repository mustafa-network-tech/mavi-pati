// Code-level enforcement of AI_AGENT_POLICY. Model output is never trusted as-is.

const moneyPattern =
  /\d[\d.,]*\s*(?:tl|₺|try|lira|bin\s*(?:tl|lira)|milyon|usd|eur|dolar|euro|\$|€)(?![a-zçğıöşü])/i;
const currencyFirstPattern = /(?:₺|\$|€)\s*\d/;
const percentPattern = /%\s*\d|\d\s*%|yüzde\s*\d/i;
const guaranteePattern =
  /garanti\s*(?:ediyor|ederiz|ediyorum|veriyor|veririz|veriyorum)|(?:kesin|kesinlikle|mutlaka)\s+sat(?:arız|ılır|acağız|ılacak)/i;

export type PolicyViolation = "PRICE_OR_AMOUNT" | "PERCENTAGE" | "GUARANTEE";

export function findPolicyViolation(text: string): PolicyViolation | null {
  if (moneyPattern.test(text) || currencyFirstPattern.test(text)) return "PRICE_OR_AMOUNT";
  if (percentPattern.test(text)) return "PERCENTAGE";
  if (guaranteePattern.test(text)) return "GUARANTEE";
  return null;
}

const timePattern = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;

// Times mentioned by the model must be among the slot times the backend offered.
export function findUnofferedTimes(text: string, offeredTimes: Iterable<string>) {
  const offered = new Set(offeredTimes);
  const mentioned = [...text.matchAll(timePattern)].map(
    ([, hour, minute]) => `${hour.padStart(2, "0")}:${minute}`,
  );
  return mentioned.filter((time) => !offered.has(time));
}
