import { test } from "node:test";
import assert from "node:assert/strict";
import { ManualWhatsAppProvider } from "../lib/providers/whatsapp";

test("manual WhatsApp provider prepares a draft deep-link without claiming delivery", async () => {
  const provider = new ManualWhatsAppProvider();
  const result = await provider.prepareOrSend({
    recipient: "+90 (555) 000 00 01",
    content: "Merhaba, Çankaya’daki 3+1 ilan için görüşebilir miyiz?",
  });
  assert.equal(result.provider, "MANUAL_DEEP_LINK");
  assert.equal(result.status, "DRAFT");
  assert.match(result.launchUrl!, /^https:\/\/wa\.me\/905550000001\?text=/);
  assert.equal(
    decodeURIComponent(result.launchUrl!.split("text=")[1]),
    "Merhaba, Çankaya’daki 3+1 ilan için görüşebilir miyiz?",
  );
});

test("manual WhatsApp provider rejects invalid recipients and empty messages", async () => {
  const provider = new ManualWhatsAppProvider();
  await assert.rejects(() => provider.prepareOrSend({ recipient: "123", content: "Merhaba" }));
  await assert.rejects(() => provider.prepareOrSend({ recipient: "+905550000001", content: "   " }));
});
